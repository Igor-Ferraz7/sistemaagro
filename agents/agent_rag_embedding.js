// agents/agent_rag_embedding.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Importa a função de embedding que está em process_data/ingest_embeddings.js
const { criarEmbedding } = require('../process_data/ingest_embeddings');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Modelo mais rápido e econômico para síntese de RAG
const MODELO_GEMINI = "gemini-2.5-flash";

// Número de documentos mais relevantes a serem buscados
const TOP_K = 5;

/**
 * Realiza uma consulta RAG baseada em Embeddings (Busca por Similaridade Vetorial).
 * @param {string} pergunta - A pergunta do usuário em linguagem natural.
 * @returns {Promise<Object>} Um objeto contendo a resposta sintetizada e o contexto utilizado.
 */
async function consultarRAG_Embedding(pergunta) {
    let contexto_final = "";

    try {
        console.log(`🧠 RAG-Embedding: Recebida pergunta: "${pergunta}"`);

        // 1. Gerar o vetor (embedding) da pergunta do usuário
        const vetor_pergunta = await criarEmbedding(pergunta);
        const vetor_string = `[${vetor_pergunta.join(',')}]`;

        console.log(`🧠 RAG-Embedding: Vetor da pergunta gerado (${vetor_pergunta.length} dimensões).`);

        // 2. Realizar a busca de similaridade vetorial (Vector Search) no PostgreSQL (pgvector)
        const documentos = await prisma.$queryRaw`
            SELECT
                texto,
                metadata,
                embedding <=> ${vetor_string}::vector AS distancia
            FROM
                "DocumentoContexto"
            ORDER BY
                distancia
                LIMIT ${TOP_K};
        `;

        // ========================================
        // 🔍 DIAGNÓSTICO COMPLETO - INÍCIO
        // ========================================

        console.log('\n🔍 DIAGNÓSTICO COMPLETO:');
        console.log('='.repeat(60));

        // Teste 1: Ver TODOS os movimentos no banco
        const todosMovimentos = await prisma.movimentoContas.findMany({
            include: {
                fornecedorCliente: true,
                classificacoes: { include: { classificacao: true } }
            }
        });

        console.log(`📊 Total de movimentos no banco: ${todosMovimentos.length}`);
        todosMovimentos.forEach((m, idx) => {
            console.log(`\nMovimento ${idx + 1}:`);
            console.log(`  ID: ${m.idMovimentoContas}`);
            console.log(`  NF: ${m.numeronotafiscal}`);
            console.log(`  Fornecedor: ${m.fornecedorCliente.razaosocial}`);
            console.log(`  Valor: ${m.valortotal}`);
            console.log(`  Data Emissão: ${m.datemissao}`);
            console.log(`  Descrição: ${m.descricao?.substring(0, 100)}...`);
        });

        // Teste 2: Ver TODOS os documentos indexados
        const todosDocsIndexados = await prisma.$queryRaw`
            SELECT id, texto, metadata
            FROM "DocumentoContexto"
            ORDER BY id
        `;

        console.log(`\n📄 Total de documentos indexados: ${todosDocsIndexados.length}`);
        todosDocsIndexados.forEach((doc, idx) => {
            console.log(`\nDoc ${idx + 1}:`);
            console.log(`  ID: ${doc.id}`);
            console.log(`  Texto (primeiros 150 chars): ${doc.texto.substring(0, 150)}...`);
            console.log(`  Metadata: ${JSON.stringify(doc.metadata)}`);
        });

        // Teste 3: Verificar duplicatas usando Prisma groupBy
        const gruposDeNotasFiscais = await prisma.movimentoContas.groupBy({
            by: ['numeronotafiscal'],
            _count: {
                numeronotafiscal: true
            },
            having: {
                numeronotafiscal: {
                    _count: {
                        gt: 1
                    }
                }
            }
        });

        console.log(`\n🔍 Notas fiscais duplicadas no banco:`);
        if (gruposDeNotasFiscais.length === 0) {
            console.log('  ✅ Nenhuma duplicata encontrada');
        } else {
            gruposDeNotasFiscais.forEach(grupo => {
                console.log(`  ⚠️ NF ${grupo.numeronotafiscal}: ${grupo._count.numeronotafiscal} ocorrências`);
            });
        }

        console.log('='.repeat(60));
        // ========================================
        // 🔍 DIAGNÓSTICO COMPLETO - FIM
        // ========================================

        // 3. Compilar o contexto dos documentos mais relevantes
        contexto_final = documentos
            .map(doc => doc.texto)
            .join('\n\n---\n\n');

        console.log(`🧠 RAG-Embedding: ${documentos.length} documentos recuperados. Contexto de ${contexto_final.length} caracteres.`);

        // Log do contexto recuperado
        console.log("📄 CONTEXTO RECUPERADO:");
        console.log("=".repeat(50));
        console.log(contexto_final);
        console.log("=".repeat(50));

        // Log das distâncias
        documentos.forEach((doc, idx) => {
            console.log(`📄 Doc ${idx + 1} - Distância: ${doc.distancia.toFixed(4)}`);
            console.log(`   Texto: ${doc.texto.substring(0, 100)}...`);
        });

        // 4. Construir o Prompt com as instruções e o Contexto
        const prompt_contextualizado = `
            Você é um assistente financeiro inteligente e prestativo.
            Use EXCLUSIVAMENTE o contexto fornecido abaixo para responder à pergunta do usuário.
            Não invente informações. Se o contexto for insuficiente, diga que não consegue responder.
            Sua resposta deve ser concisa e focada nos dados.

            --- CONTEXTO DAS NOTAS FISCAIS ---
            ${contexto_final}
            ----------------------------------

            PERGUNTA DO USUÁRIO: ${pergunta}
        `;

        // 5. Chamar a API do Gemini para sintetizar a resposta
        const model = genAI.getGenerativeModel({
            model: MODELO_GEMINI,
            generationConfig: {
                temperature: 0.1
            }
        });

        const result = await model.generateContent(prompt_contextualizado);
        const respostaTexto = result.response.text();
        console.log("retorno em txt:", respostaTexto);

        // 6. Retornar a resposta e o contexto
        return {
            resposta: respostaTexto,
            contexto_usado: contexto_final,
            documentos_originais: documentos.map(d => ({
                texto: d.texto,
                distancia: parseFloat(d.distancia)
            }))
        };

    } catch (error) {
        console.error('❌ ERRO no Agente RAG Embedding:', error.message);
        console.error('Stack trace:', error.stack);
        return {
            resposta: 'Desculpe, ocorreu um erro ao consultar o índice vetorial. Verifique se o servidor do PostgreSQL está ativo e se o índice foi criado corretamente.',
            contexto_usado: contexto_final,
            error: error.message
        };
    }
}

module.exports = {
    consultarRAG_Embedding
};