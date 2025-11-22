// process_data/ingest_embeddings.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { EMBEDDING_MODEL } = require('../geminiConfig');
const prisma = new PrismaClient();

/**
 * Cria o vetor (embedding) para uma string de texto.
 */
async function criarEmbedding(texto) {
    try {
        // 1. Se não tiver chave configurada (vazia/null), retorna null silenciosamente
        if (!process.env.GEMINI_API_KEY) return null;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

        const result = await model.embedContent({
            content: { parts: [{ text: texto }], role: "user" }
        });

        return result.embedding.values;

    } catch (error) {
        // 2. TRATAMENTO ESPECÍFICO: Se a chave existir mas for INVÁLIDA (Erro 400 do Google)
        if (error.message.includes('API_KEY_INVALID') || error.message.includes('400 Bad Request')) {
            // Não poluímos o log com erro vermelho, apenas um aviso amarelo
            console.warn('   ⚠️  Aviso: A chave de API atual é inválida ou foi rejeitada pelo Google. Ignorando este embedding.');
            return null; 
        }

        // Outros erros (conexão, limite, etc) continuam sendo logados
        console.error('   ❌ Erro ao criar embedding:', error.message);
        return null;
    }
}

/**
 * 🚀 Inicia o processo de ingestão de dados.
 */
async function ingestaoInicial() {
    try {
        console.log('\n======================================');
        console.log('  🚀 INICIANDO INGESTÃO DE EMBEDDINGS');
        console.log('======================================');

        if (!process.env.GEMINI_API_KEY) {
            console.log('⚠️ API Key não detectada. A ingestão será ignorada até a configuração.');
            console.log('======================================');
            return;
        }

        // Limpa índice anterior
        await prisma.$executeRaw`DELETE FROM "DocumentoContexto"`;
        console.log('  -> Índice vetorial anterior limpo.');

        const movimentos = await prisma.movimentoContas.findMany({
            include: {
                fornecedorCliente: { select: { razaosocial: true } },
                classificacoes: { include: { classificacao: { select: { descricao: true } } } }
            }
        });

        if (movimentos.length === 0) {
            console.log('⚠️ Nenhuma nota fiscal encontrada para indexar.');
            return;
        }

        console.log(`📝 Processando ${movimentos.length} movimentos...`);

        let processados = 0;
        let falhasChave = 0;

        for (const movimento of movimentos) {
            try {
                // Se já falhou muitas vezes por chave inválida, aborta o loop para não travar o boot
                if (falhasChave > 2) {
                    console.log('⚠️ Ingestão abortada: Chave de API inválida. Configure via interface.');
                    break;
                }

                const classificacaoNomes = movimento.classificacoes.map(c => c.classificacao.descricao).join(', ');
                
                const texto_contexto = `
                    Movimento ID: ${movimento.idMovimentoContas}. 
                    Nota Fiscal: ${movimento.numeronotafiscal || 'N/A'}. 
                    Fornecedor: ${movimento.fornecedorCliente ? movimento.fornecedorCliente.razaosocial : 'N/A'}. 
                    Categoria(s): ${classificacaoNomes}. 
                    Valor Total: ${parseFloat(movimento.valortotal).toFixed(2)}. 
                    Descrição: ${movimento.descricao}.
                    Data de Emissão: ${new Date(movimento.datemissao).toISOString().split('T')[0]}.
                `.trim();

                const embedding = await criarEmbedding(texto_contexto);
                
                if (embedding) {
                    const embeddingString = `[${embedding.join(',')}]`;
                    const metadataJson = JSON.stringify({
                        movimento_id: movimento.idMovimentoContas,
                        categoria: classificacaoNomes,
                        numero_nf: movimento.numeronotafiscal
                    });

                    await prisma.$executeRaw`
                        INSERT INTO "DocumentoContexto" (texto, embedding, metadata, "createdAt", "updatedAt")
                        VALUES (${texto_contexto}, ${embeddingString}::vector, ${metadataJson}::jsonb, NOW(), NOW())
                    `;
                    processados++;
                } else {
                    // Se retornou null, conta como falha potencial de chave
                    falhasChave++;
                }

            } catch (error) {
                console.error(`   ❌ ERRO movimento ${movimento.idMovimentoContas}:`, error.message);
            }
        }

        console.log('\n======================================');
        console.log(`✅ Indexação concluída: ${processados} documentos processados.`);
        console.log('======================================');

    } catch (e) {
        console.error('❌ ERRO CRÍTICO NA INGESTÃO:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

module.exports = { criarEmbedding, ingestaoInicial };