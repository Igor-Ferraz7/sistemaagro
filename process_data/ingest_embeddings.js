// process_data/ingest_embeddings.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// O modelo recomendado do Google para embeddings de alta qualidade.
const MODELO_EMBEDDING = "text-embedding-004";
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Cria o vetor (embedding) para uma string de texto.
 * ATENÇÃO: Esta função é reutilizada pelo agent_rag_embedding.js.
 * @param {string} texto - O chunk de texto a ser vetorizado.
 * @returns {Promise<number[]>} O vetor (array de floats).
 */
async function criarEmbedding(texto) {
    try {
        const model = genAI.getGenerativeModel({ model: MODELO_EMBEDDING });

        const result = await model.embedContent({
            content: {
                parts: [{ text: texto }],
                role: "user"
            }
        });

        return result.embedding.values;

    } catch (error) {
        console.error('❌ Erro ao criar embedding:', error.message);
        console.error('Detalhes completos:', error);
        throw new Error('Falha na criação do embedding pela API do Gemini.');
    }
}

/**
 * 🚀 Inicia o processo de ingestão de dados e criação de índices vetoriais.
 * Faz a limpeza e indexação de todos os movimentos de contas.
 */
async function ingestaoInicial() {
    try {
        console.log('\n======================================');
        console.log('  🚀 INICIANDO INGESTÃO DE EMBEDDINGS');
        console.log('======================================');

        // Garante que o índice esteja limpo antes de reindexar
        await prisma.$executeRaw`DELETE FROM "DocumentoContexto"`;
        console.log('  -> Índice vetorial anterior limpo.');

        // 1. Puxar todos os Movimentos com as informações de contexto necessárias
        const movimentos = await prisma.movimentoContas.findMany({
            include: {
                fornecedorCliente: { select: { razaosocial: true } },
                classificacoes: {
                    include: {
                        classificacao: { select: { descricao: true } }
                    }
                }
            }
        });

        if (movimentos.length === 0) {
            console.log('⚠️ Nenhuma nota fiscal encontrada para indexar.');
            return;
        }

        console.log(`📝 Processando ${movimentos.length} movimentos...`);

        // Processar em lotes para evitar sobrecarga
        const BATCH_SIZE = 10;
        let processados = 0;

        for (let i = 0; i < movimentos.length; i += BATCH_SIZE) {
            const lote = movimentos.slice(i, i + BATCH_SIZE);

            const promessas = lote.map(async (movimento) => {
                try {
                    console.log(`\n📝 Processando movimento ${movimento.idMovimentoContas}:`);
                    console.log(`   NF: ${movimento.numeronotafiscal}`);
                    console.log(`   Fornecedor: ${movimento.fornecedorCliente.razaosocial}`);

                    // Extrai nomes de classificação
                    const classificacaoNomes = movimento.classificacoes
                        .map(c => c.classificacao.descricao)
                        .join(', ');

                    // 2. Criar o chunk de texto com alto contexto semântico
                    const texto_contexto = `
                        Movimento ID: ${movimento.idMovimentoContas}. 
                        Nota Fiscal: ${movimento.numeronotafiscal || 'N/A'}. 
                        Fornecedor: ${movimento.fornecedorCliente.razaosocial}. 
                        Categoria(s): ${classificacaoNomes}. 
                        Valor Total: ${movimento.valortotal.toFixed(2)}. 
                        Descrição dos Itens: ${movimento.descricao}.
                        Data de Emissão: ${movimento.datemissao.toISOString().split('T')[0]}.
                    `.trim();

                    console.log(`   Texto gerado (${texto_contexto.length} chars)`);
                    console.log(`   Preview: ${texto_contexto.substring(0, 100)}...`);

                    // 3. Gerar o vetor (embedding)
                    const embedding = await criarEmbedding(texto_contexto);
                    console.log(`   Embedding gerado (${embedding.length} dimensões)`);

                    // 4. Salvar no índice vetorial usando SQL Raw (pgvector não é totalmente suportado pelo Prisma)
                    const embeddingString = `[${embedding.join(',')}]`;
                    const metadataJson = JSON.stringify({
                        movimento_id: movimento.idMovimentoContas,
                        categoria: classificacaoNomes,
                        numero_nf: movimento.numeronotafiscal
                    });

                    await prisma.$executeRaw`
                        INSERT INTO "DocumentoContexto" (texto, embedding, metadata, "createdAt", "updatedAt")
                        VALUES (
                            ${texto_contexto},
                            ${embeddingString}::vector,
                            ${metadataJson}::jsonb,
                            NOW(),
                            NOW()
                        )
                    `;

                    console.log(`   ✅ Indexado com sucesso`);

                    processados++;
                    if (processados % 10 === 0) {
                        console.log(`\n  ⏳ Processados ${processados}/${movimentos.length} movimentos...`);
                    }
                } catch (error) {
                    console.error(`   ❌ ERRO ao processar movimento ${movimento.idMovimentoContas}:`);
                    console.error(`   Mensagem: ${error.message}`);
                    console.error(`   Stack: ${error.stack}`);
                }
            });

            await Promise.all(promessas);
        }

        console.log('\n======================================');
        console.log(`✅ Indexação de ${processados} documentos concluída.`);
        console.log('======================================');

    } catch (e) {
        console.error('❌ ERRO CRÍTICO NA INGESTÃO DE EMBEDDINGS:', e);
        console.error('Stack completo:', e.stack);
        console.log('\nCERTIFIQUE-SE DE TER EXECUTADO: npm install @prisma/client && npx prisma migrate dev');
        throw new Error('Falha na Ingestão de Embeddings. Verifique o console para detalhes.');
    } finally {
        await prisma.$disconnect();
    }
}

module.exports = {
    criarEmbedding,
    ingestaoInicial
};