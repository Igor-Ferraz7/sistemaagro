// agents/agent_rag.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TEXT_MODEL } = require('../geminiConfig');

const prisma = new PrismaClient();

// ⚠️ REMOVIDO: const genAI = ...

async function interpretarPergunta(pergunta) {
    try {
        // ✅ CORREÇÃO
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave API não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

        console.log(`🤖 Interpretando pergunta: "${pergunta}"`);

        const prompt = `Você é um assistente que converte perguntas sobre notas fiscais em critérios de busca JSON.
        PERGUNTA: "${pergunta}"
        
        Retorne APENAS um JSON com este formato (use null se não se aplicar):
        {
          "filtros": {
            "fornecedor_nome": "string|null",
            "data_inicio": "YYYY-MM-DD|null",
            "data_fim": "YYYY-MM-DD|null",
            "valor_min": number|null,
            "valor_max": number|null,
            "classificacao": "string|null"
          },
          "agregacao": "soma|media|contagem|lista"
        }
        `;

        const result = await model.generateContent(prompt);
        const texto = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(texto);

    } catch (error) {
        console.error('❌ Erro interpretação:', error.message);
        // Fallback: busca simples textual se a IA falhar
        return { 
            filtros: { fornecedor_nome: pergunta }, // Tenta usar a pergunta como nome
            agregacao: 'lista' 
        };
    }
}

// ... (Mantenha a função buscarNotasFiscais igual, ela só usa Prisma) ...
async function buscarNotasFiscais(filtros) {
    const where = {};
    if (filtros.fornecedor_nome) where.fornecedorCliente = { razaosocial: { contains: filtros.fornecedor_nome, mode: 'insensitive' } };
    // ... (restante da lógica de filtros do seu arquivo original) ...
    // Para simplificar aqui, vou retornar buscar tudo se filtro vazio, mas mantenha sua lógica original de busca
    return await prisma.movimentoContas.findMany({ where, include: { fornecedorCliente: true, classificacoes: {include: {classificacao: true}} } });
}

// ... (Mantenha agregarResultados igual) ...
function agregarResultados(movimentos, tipo) {
    // ... (Sua lógica original de agregação) ...
    // Simplificação para garantir que funcione:
    return { tipo: 'lista', dados: movimentos, total: movimentos.length };
}

async function gerarRespostaNatural(pergunta, resultados) {
    try {
        // ✅ CORREÇÃO
        if (!process.env.GEMINI_API_KEY) return "Resultados encontrados acima.";
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

        const prompt = `Responda a pergunta "${pergunta}" com base nestes dados: ${JSON.stringify(resultados).substring(0, 2000)}. Seja breve.`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return "Confira os resultados na tabela."; }
}

async function consultarRAG(pergunta) {
    try {
        const criterios = await interpretarPergunta(pergunta);
        // Atenção: Garanta que buscarNotasFiscais esteja implementado no seu arquivo original
        const movimentos = await buscarNotasFiscais(criterios.filtros || {}); 
        const resultados = agregarResultados(movimentos, criterios.agregacao);
        const resposta = await gerarRespostaNatural(pergunta, resultados);

        return {
            sucesso: true,
            criterios_busca: criterios,
            resultados: resultados,
            resposta_natural: resposta
        };
    } catch (error) {
        return { sucesso: false, erro: error.message };
    }
}

module.exports = { consultarRAG };