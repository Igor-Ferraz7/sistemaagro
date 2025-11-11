// agents/agent_rag.js
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELO_GEMINI = "gemini-2.5-flash";
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ... (Restante do código: interpretarPergunta, buscarNotasFiscais, etc.)

/**
 * Converte uma pergunta em linguagem natural para critérios de busca SQL
 * @param {string} pergunta - Pergunta do usuário em linguagem natural
 * @returns {Promise<Object>} Critérios de busca estruturados
 */
async function interpretarPergunta(pergunta) {
    try {
        console.log(`🤖 Interpretando pergunta: "${pergunta}"`);

        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });

        const prompt = `Você é um assistente que converte perguntas sobre notas fiscais em critérios de busca estruturados.

PERGUNTA DO USUÁRIO: "${pergunta}"

Analise a pergunta e retorne UM JSON com os seguintes campos (use null se não aplicável):

{
  "tipo_consulta": "fornecedor" | "periodo" | "valor" | "categoria" | "geral",
  "filtros": {
    "fornecedor_nome": "string ou null (nome ou parte do nome)",
    "fornecedor_cnpj": "string ou null (apenas números)",
    "data_inicio": "YYYY-MM-DD ou null",
    "data_fim": "YYYY-MM-DD ou null",
    "valor_min": number ou null,
    "valor_max": number ou null,
    "classificacao": "string ou null (categoria de despesa)",
    "numero_nota": "string ou null"
  },
  "agregacao": "soma" | "media" | "contagem" | "lista" | null,
  "resposta_amigavel": "string (reformule a pergunta de forma clara)"
}

EXEMPLOS:

Pergunta: "Quanto gastei com a empresa XYZ em outubro?"
Resposta: {
  "tipo_consulta": "fornecedor",
  "filtros": {
    "fornecedor_nome": "XYZ",
    "data_inicio": "2024-10-01",
    "data_fim": "2024-10-31",
    ...
  },
  "agregacao": "soma",
  "resposta_amigavel": "Total gasto com fornecedor XYZ em outubro de 2024"
}

Pergunta: "Mostre todas as notas acima de R$ 5000"
Resposta: {
  "tipo_consulta": "valor",
  "filtros": {
    "valor_min": 5000,
    ...
  },
  "agregacao": "lista",
  "resposta_amigavel": "Notas fiscais com valor superior a R$ 5.000,00"
}

IMPORTANTE: 
- Para datas, use o formato YYYY-MM-DD
- Para valores monetários, converta para número (ex: "R$ 5.000" = 5000)
- Se o usuário mencionar "este mês", "hoje", use a data atual como referência
- Retorne APENAS o JSON, sem texto adicional`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const texto = response.text().trim();

        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Resposta do Gemini não contém JSON válido');
        }

        const criterios = JSON.parse(jsonMatch[0]);
        console.log('✅ Critérios interpretados:', criterios);

        return criterios;

    } catch (error) {
        console.error('❌ Erro ao interpretar pergunta:', error);
        throw new Error(`Falha na interpretação: ${error.message}`);
    }
}

/**
 * Busca notas fiscais no banco de dados baseado em critérios
 * @param {Object} filtros - Filtros de busca
 * @returns {Promise<Array>} Lista de movimentos encontrados
 */
async function buscarNotasFiscais(filtros) {
    try {
        console.log('🔍 Buscando notas fiscais com filtros:', filtros);

        const where = {};

        // Filtro por fornecedor (nome parcial)
        if (filtros.fornecedor_nome) {
            where.fornecedorCliente = {
                razaosocial: {
                    contains: filtros.fornecedor_nome,
                    mode: 'insensitive'
                }
            };
        }

        // Filtro por CNPJ
        if (filtros.fornecedor_cnpj) {
            const cnpjLimpo = filtros.fornecedor_cnpj.replace(/\D/g, '');
            where.fornecedorCliente = {
                documento: cnpjLimpo
            };
        }

        // Filtro por data
        if (filtros.data_inicio || filtros.data_fim) {
            where.datemissao = {};
            if (filtros.data_inicio) {
                where.datemissao.gte = new Date(filtros.data_inicio);
            }
            if (filtros.data_fim) {
                where.datemissao.lte = new Date(filtros.data_fim);
            }
        }

        // Filtro por valor
        if (filtros.valor_min !== null || filtros.valor_max !== null) {
            where.valortotal = {};
            if (filtros.valor_min !== null) {
                where.valortotal.gte = filtros.valor_min;
            }
            if (filtros.valor_max !== null) {
                where.valortotal.lte = filtros.valor_max;
            }
        }

        // Filtro por classificação
        if (filtros.classificacao) {
            where.classificacoes = {
                some: {
                    classificacao: {
                        descricao: {
                            contains: filtros.classificacao,
                            mode: 'insensitive'
                        }
                    }
                }
            };
        }

        // Filtro por número da nota
        if (filtros.numero_nota) {
            where.numeronotafiscal = {
                contains: filtros.numero_nota
            };
        }

        const movimentos = await prisma.movimentoContas.findMany({
            where,
            include: {
                fornecedorCliente: true,
                faturado: true,
                parcelas: true,
                classificacoes: {
                    include: {
                        classificacao: true
                    }
                }
            },
            orderBy: {
                datemissao: 'desc'
            }
        });

        console.log(`✅ Encontradas ${movimentos.length} notas fiscais`);
        return movimentos;

    } catch (error) {
        console.error('❌ Erro ao buscar notas fiscais:', error);
        throw new Error(`Falha na busca: ${error.message}`);
    }
}

/**
 * Aplica agregação nos resultados
 * @param {Array} movimentos - Lista de movimentos
 * @param {string} tipoAgregacao - Tipo de agregação (soma, media, contagem, lista)
 * @returns {Object} Resultado agregado
 */
function agregarResultados(movimentos, tipoAgregacao) {
    if (!tipoAgregacao || tipoAgregacao === 'lista') {
        return {
            tipo: 'lista',
            total: movimentos.length,
            dados: movimentos.map(m => ({
                id: m.idMovimentoContas,
                numero_nf: m.numeronotafiscal,
                fornecedor: m.fornecedorCliente.razaosocial,
                valor: parseFloat(m.valortotal),
                data: m.datemissao,
                descricao: m.descricao,
                classificacao: m.classificacoes[0]?.classificacao?.descricao || 'N/A'
            }))
        };
    }

    if (tipoAgregacao === 'soma') {
        const soma = movimentos.reduce((acc, m) => acc + parseFloat(m.valortotal), 0);
        return {
            tipo: 'soma',
            total: movimentos.length,
            valor_total: soma,
            valor_total_formatado: soma.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            })
        };
    }

    if (tipoAgregacao === 'media') {
        const soma = movimentos.reduce((acc, m) => acc + parseFloat(m.valortotal), 0);
        const media = movimentos.length > 0 ? soma / movimentos.length : 0;
        return {
            tipo: 'media',
            total: movimentos.length,
            valor_medio: media,
            valor_medio_formatado: media.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            })
        };
    }

    if (tipoAgregacao === 'contagem') {
        return {
            tipo: 'contagem',
            total: movimentos.length
        };
    }

    return { tipo: 'desconhecido', dados: movimentos };
}

/**
 * Gera uma resposta em linguagem natural usando Gemini
 * @param {string} pergunta - Pergunta original do usuário
 * @param {Object} resultados - Resultados da busca e agregação
 * @returns {Promise<string>} Resposta em linguagem natural
 */
async function gerarRespostaNatural(pergunta, resultados) {
    try {
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });

        const prompt = `Você é um assistente financeiro que responde perguntas sobre notas fiscais de forma clara e objetiva.

PERGUNTA DO USUÁRIO: "${pergunta}"

DADOS ENCONTRADOS:
${JSON.stringify(resultados, null, 2)}

Gere uma resposta em português do Brasil que:
1. Seja direta e objetiva
2. Apresente os números de forma clara (use formatação brasileira para valores)
3. Se houver muitos resultados, resuma os principais pontos
4. Se não houver resultados, explique de forma amigável

RESPOSTA:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();

    } catch (error) {
        console.error('❌ Erro ao gerar resposta natural:', error);
        return 'Desculpe, não consegui formular uma resposta adequada.';
    }
}

/**
 * Função principal do RAG: processa pergunta e retorna resposta
 * @param {string} pergunta - Pergunta do usuário
 * @returns {Promise<Object>} Resposta completa com dados e texto
 */
async function consultarRAG(pergunta) {
    try {
        console.log('\n🚀 Iniciando consulta RAG...');

        // 1. Interpretar a pergunta
        const criterios = await interpretarPergunta(pergunta);

        // 2. Buscar no banco de dados
        const movimentos = await buscarNotasFiscais(criterios.filtros);

        // 3. Agregar resultados
        const resultadosAgregados = agregarResultados(movimentos, criterios.agregacao);

        // 4. Gerar resposta em linguagem natural
        const respostaNatural = await gerarRespostaNatural(pergunta, resultadosAgregados);

        console.log('✅ Consulta RAG concluída\n');

        return {
            sucesso: true,
            pergunta_original: pergunta,
            criterios_busca: criterios,
            resultados: resultadosAgregados,
            resposta_natural: respostaNatural,
            metadados: {
                total_encontrado: movimentos.length,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        console.error('❌ Erro na consulta RAG:', error);
        return {
            sucesso: false,
            erro: error.message,
            pergunta_original: pergunta
        };
    }
}

module.exports = {
    consultarRAG,
    interpretarPergunta,
    buscarNotasFiscais,
    agregarResultados,
    gerarRespostaNatural
};