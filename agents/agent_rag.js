// agents/agent_rag.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TEXT_MODEL } = require('../geminiConfig'); // Garante o uso do modelo centralizado

const prisma = new PrismaClient();

async function interpretarPergunta(pergunta) {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave API não configurada");
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

        console.log(`🤖 Interpretando pergunta: "${pergunta}"`);

        const prompt = `Você é um assistente que converte perguntas de linguagem natural sobre notas fiscais em critérios de busca estruturados (JSON).
        
        PERGUNTA DO USUÁRIO: "${pergunta}"
        
        Analise a pergunta e extraia filtros para consultar um banco de dados.
        
        CAMPOS DE FILTRO POSSÍVEIS:
        - fornecedor_nome (string): Nome ou parte do nome da empresa
        - data_inicio (YYYY-MM-DD): Data inicial para busca
        - data_fim (YYYY-MM-DD): Data final para busca
        - valor_min (number): Valor monetário mínimo
        - valor_max (number): Valor monetário máximo
        - classificacao (string): Categoria da despesa (ex: "ADMINISTRATIVAS")
        
        TIPO DE AGREGAÇÃO:
        - "lista": Para listar os itens (padrão)
        - "soma": Para somar valores (ex: "quanto gastei", "total")
        - "media": Para média de valores
        - "contagem": Para contar quantidade
        
        RESPOSTA ESPERADA (APENAS JSON):
        {
          "filtros": {
            "fornecedor_nome": null,
            "data_inicio": null,
            "data_fim": null,
            "valor_min": null,
            "valor_max": null,
            "classificacao": null
          },
          "agregacao": "lista"
        }`;

        const result = await model.generateContent(prompt);
        const texto = result.response.text().replace(/```json|```/g, '').trim();
        
        const jsonInterpretado = JSON.parse(texto);
        console.log("✅ Interpretação JSON:", JSON.stringify(jsonInterpretado));
        return jsonInterpretado;

    } catch (error) {
        console.error('❌ Erro na interpretação da pergunta:', error.message);
        // Fallback seguro: Tenta buscar a pergunta como nome de fornecedor
        return { 
            filtros: { fornecedor_nome: pergunta },
            agregacao: 'lista' 
        };
    }
}

async function buscarNotasFiscais(filtros) {
    const where = {};

    try {
        // 1. Filtro por Fornecedor (Busca na relação fornecedorCliente)
        if (filtros.fornecedor_nome) {
            where.fornecedorCliente = {
                razaosocial: { contains: filtros.fornecedor_nome, mode: 'insensitive' }
            };
        }

        // 2. Filtro por Datas (Emissão)
        if (filtros.data_inicio || filtros.data_fim) {
            where.datemissao = {};
            if (filtros.data_inicio) where.datemissao.gte = new Date(filtros.data_inicio);
            if (filtros.data_fim) where.datemissao.lte = new Date(filtros.data_fim);
        }

        // 3. Filtro por Valores
        if (filtros.valor_min !== null || filtros.valor_max !== null) {
            where.valortotal = {};
            // O Prisma espera Decimal ou Float, garantimos que seja numérico
            if (filtros.valor_min !== null) where.valortotal.gte = parseFloat(filtros.valor_min);
            if (filtros.valor_max !== null) where.valortotal.lte = parseFloat(filtros.valor_max);
        }

        // 4. Filtro por Classificação (Busca na relação classificacoes)
        if (filtros.classificacao) {
            where.classificacoes = {
                some: {
                    classificacao: {
                        descricao: { contains: filtros.classificacao, mode: 'insensitive' }
                    }
                }
            };
        }

        console.log("🔍 Executando query Prisma com where:", JSON.stringify(where));

        const movimentos = await prisma.movimentoContas.findMany({
            where,
            include: {
                fornecedorCliente: true,
                classificacoes: {
                    include: { classificacao: true }
                }
            },
            orderBy: { datemissao: 'desc' },
            take: 50 // Limite de segurança para não travar
        });

        return movimentos;

    } catch (error) {
        console.error("❌ Erro na busca do Prisma:", error);
        return []; // Retorna array vazio em vez de explodir
    }
}

function agregarResultados(movimentos, tipoAgregacao) {
    let dadosProcessados = [];
    let valorTotal = 0;

    // Mapeia os dados brutos do Prisma para um formato mais limpo
    const listaFormatada = movimentos.map(m => ({
        id: m.idMovimentoContas,
        numero_nf: m.numeronotafiscal,
        fornecedor: m.fornecedorCliente?.razaosocial || 'N/A',
        data: m.datemissao,
        valor: parseFloat(m.valortotal), // Converte Decimal para Float JS
        classificacao: m.classificacoes.map(c => c.classificacao.descricao).join(', ')
    }));

    // Calcula totais
    listaFormatada.forEach(item => valorTotal += item.valor);

    // Formata retorno baseado na agregação pedida pela IA
    const resultado = {
        tipo: tipoAgregacao,
        total_registros: movimentos.length,
        valor_total_numerico: valorTotal,
        valor_total_formatado: valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        valor_medio_formatado: movimentos.length > 0 ? (valorTotal / movimentos.length).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00',
        dados: listaFormatada
    };

    return resultado;
}

async function gerarRespostaNatural(pergunta, resultados) {
    try {
        if (!process.env.GEMINI_API_KEY) return "Resultados encontrados na tabela abaixo.";
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

        // Resumo compacto para o prompt não ficar gigante
        const resumoDados = {
            tipo_busca: resultados.tipo,
            qtd_encontrada: resultados.total_registros,
            soma_total: resultados.valor_total_formatado,
            media: resultados.valor_medio_formatado,
            lista_itens: resultados.dados.slice(0, 10) // Manda só os 10 primeiros para a IA não se perder
        };

        const prompt = `
        Atue como um analista financeiro. Responda à pergunta do usuário com base nos dados encontrados no sistema.
        
        PERGUNTA: "${pergunta}"
        
        DADOS DO SISTEMA:
        ${JSON.stringify(resumoDados)}
        
        INSTRUÇÕES:
        - Seja direto e profissional.
        - Se for uma lista, cite alguns exemplos.
        - Se for uma soma, dê o valor total.
        - Não mencione "JSON" ou termos técnicos.
        `;

        const result = await model.generateContent(prompt);
        return result.response.text();

    } catch (e) {
        console.error("❌ Erro ao gerar resposta natural:", e);
        return "Aqui estão os dados encontrados para sua busca.";
    }
}

async function consultarRAG(pergunta) {
    console.log("🚀 Iniciando ConsultarRAG Simples...");
    try {
        // 1. Interpretar (IA)
        const criterios = await interpretarPergunta(pergunta);
        
        // 2. Buscar (Banco)
        const movimentos = await buscarNotasFiscais(criterios.filtros || {});
        console.log(`📊 ${movimentos.length} registros encontrados.`);

        // 3. Processar (Lógica)
        const resultados = agregarResultados(movimentos, criterios.agregacao);

        // 4. Responder (IA)
        const resposta = await gerarRespostaNatural(pergunta, resultados);

        return {
            sucesso: true,
            criterios_busca: criterios.filtros,
            resultados: resultados,
            resposta_natural: resposta
        };

    } catch (error) {
        console.error("❌ Erro CRÍTICO no consultarRAG:", error);
        return { 
            sucesso: false, 
            erro: `Falha no processamento: ${error.message}` 
        };
    }
}

module.exports = { consultarRAG };