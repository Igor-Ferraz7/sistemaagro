// agents/agent_rag_embedding.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { criarEmbedding } = require('../process_data/ingest_embeddings');
const { TEXT_MODEL } = require('../geminiConfig');

const prisma = new PrismaClient();

async function consultarRAG_Embedding(pergunta) {
    try {
        // ✅ CORREÇÃO: Checagem de chave
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        
        // 1. Gera vetor da pergunta (criarEmbedding já foi corrigido no passo 1)
        const vetor = await criarEmbedding(pergunta);
        if (!vetor) throw new Error("Falha ao gerar vetor da pergunta");

        const vetorString = `[${vetor.join(',')}]`;

        // 2. Busca no banco
        const documentos = await prisma.$queryRaw`
            SELECT texto, embedding <=> ${vetorString}::vector AS distancia
            FROM "DocumentoContexto"
            ORDER BY distancia ASC
            LIMIT 5
        `;

        const contexto = documentos.map(d => d.texto).join('\n---\n');

        // 3. Gera resposta (Instancia localmente)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

        const prompt = `Com base no contexto:\n${contexto}\n\nResponda: ${pergunta}`;
        const result = await model.generateContent(prompt);

        return {
            resposta: result.response.text(),
            contexto_vetorial: contexto
        };

    } catch (error) {
        console.error(error);
        return { resposta: "Erro na consulta vetorial.", error: error.message };
    }
}

module.exports = { consultarRAG_Embedding };