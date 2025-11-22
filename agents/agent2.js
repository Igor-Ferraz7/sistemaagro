const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TEXT_MODEL } = require('../geminiConfig');

const prisma = new PrismaClient();

// ⚠️ REMOVIDO: Inicialização global retirada para evitar erro de chave.
// A conexão será aberta dentro de cada função.

/**
 * Conecta ao banco de dados
 */
async function connectDb() {
    await prisma.$connect();
    console.log('📊 Banco de Dados: ✅ Conectado');
}

async function disconnectDb() {
    await prisma.$disconnect();
    console.log('📊 Banco de Dados: ❌ Desconectado');
}

// ===== OPERAÇÕES COM PESSOAS (FORNECEDORES/FATURADOS) =====

async function consultarPessoa(documento) {
    if (!documento) return null;
    const docLimpo = documento.replace(/\D/g, '');
    return await prisma.pessoas.findFirst({ where: { documento: docLimpo } });
}

async function criarOuConsultarPessoa(documento, razaoSocial, tipo, fantasia = null) {
    const docLimpo = documento ? documento.replace(/\D/g, '') : null;
    
    if (!docLimpo || !razaoSocial) {
        return { status: 'ERRO_DADOS', message: `Dados insuficientes para criar/consultar ${tipo}` };
    }

    let pessoa = await consultarPessoa(docLimpo);

    if (pessoa) {
        return { status: 'EXISTE', id: pessoa.idPessoas, data: pessoa, message: 'EXISTE', documento: docLimpo, razaoSocial: pessoa.razaosocial };
    } else {
        const newPessoa = await prisma.pessoas.create({
            data: {
                tipo: docLimpo.length > 11 ? 'JURIDICA' : 'FISICA',
                razaosocial: razaoSocial,
                fantasia: fantasia || razaoSocial,
                documento: docLimpo,
                status: 'ATIVO'
            }
        });
        return { status: 'CRIADO', id: newPessoa.idPessoas, data: newPessoa, message: 'NÃO EXISTE (CRIADO AGORA)', documento: docLimpo, razaoSocial: newPessoa.razaosocial };
    }
}

async function atualizarPessoa(id, dados) {
    return await prisma.pessoas.update({ where: { idPessoas: id }, data: dados });
}

async function excluirPessoa(id) {
    try {
        const movimentosFornecedor = await prisma.movimentoContas.count({ where: { Pessoas_idFornecedorCliente: id } });
        const movimentosFaturado = await prisma.movimentoContas.count({ where: { Pessoas_idFaturado: id } });
        
        if (movimentosFornecedor > 0 || movimentosFaturado > 0) {
            return { status: 'ERRO', message: 'Não é possível excluir esta pessoa pois está vinculada a movimentos.' };
        }
        
        await prisma.pessoas.delete({ where: { idPessoas: id } });
        return { status: 'SUCESSO', message: 'Pessoa excluída com sucesso.' };
    } catch (error) {
        return { status: 'ERRO', message: `Erro ao excluir pessoa: ${error.message}` };
    }
}

// ===== OPERAÇÕES COM CLASSIFICAÇÃO =====

async function consultarClassificacao(descricao, tipo = 'DESPESA') {
    if (!descricao) return null;
    return await prisma.classificacao.findFirst({
        where: { descricao: { equals: descricao, mode: 'insensitive' }, tipo: tipo }
    });
}

async function criarOuConsultarClassificacao(descricao, tipo = 'DESPESA') {
    if (!descricao) return { status: 'ERRO_DADOS', message: `Descrição de ${tipo.toLowerCase()} não fornecida` };
    
    let classificacao = await consultarClassificacao(descricao, tipo);

    if (classificacao) {
        return { status: 'EXISTE', id: classificacao.idClassificacao, data: classificacao, message: 'EXISTE' };
    } else {
        const newClassificacao = await prisma.classificacao.create({
            data: { tipo: tipo, descricao: descricao, status: 'ATIVA' }
        });
        return { status: 'CRIADO', id: newClassificacao.idClassificacao, data: newClassificacao, message: 'NÃO EXISTE (CRIADO AGORA)' };
    }
}

async function atualizarClassificacao(id, dados) {
    return await prisma.classificacao.update({ where: { idClassificacao: id }, data: dados });
}

async function excluirClassificacao(id) {
    try {
        const movimentos = await prisma.movimentoContasClassificacao.count({ where: { Classificacao_idClassificacao: id } });
        if (movimentos > 0) return { status: 'ERRO', message: 'Não é possível excluir esta classificação pois está vinculada a movimentos.' };
        
        await prisma.classificacao.delete({ where: { idClassificacao: id } });
        return { status: 'SUCESSO', message: 'Classificação excluída com sucesso.' };
    } catch (error) {
        return { status: 'ERRO', message: `Erro ao excluir classificação: ${error.message}` };
    }
}

// ===== OPERAÇÕES COM MOVIMENTO DE CONTAS =====

async function criarMovimentoEParcela(data, idFornecedor, idFaturado, idClassificacao) {
    const valorTotalReais = parseFloat(data.valor_total) / 100; 
    const dataEmissao = new Date(data.data_emissao);
    const dataVencimento = data.data_vencimento ? new Date(data.data_vencimento) : new Date(); 
    const quantidadeParcelas = data.quantidade_parcelas || 1;
    const valorParcela = valorTotalReais / quantidadeParcelas;
    const identificacaoParcela = `1/${quantidadeParcelas}`;

    if (!idFornecedor || !idFaturado || !idClassificacao || isNaN(valorTotalReais) || valorTotalReais <= 0) {
        throw new Error("Dados de Movimento, Parcela ou IDs de dependência inválidos.");
    }

    const movimento = await prisma.movimentoContas.create({
        data: {
            tipo: 'APAGAR', 
            numeronotafiscal: data.numero_nota_fiscal,
            datemissao: dataEmissao,
            descricao: data.descricao_produtos || `NF ${data.numero_nota_fiscal}`,
            status: 'PENDENTE', 
            valortotal: valorTotalReais,
            Pessoas_idFornecedorCliente: idFornecedor,
            Pessoas_idFaturado: idFaturado,
            classificacoes: { create: { Classificacao_idClassificacao: idClassificacao } },
            parcelas: {
                create: {
                    identificacao: identificacaoParcela,
                    datavencimento: dataVencimento, 
                    valorparcela: valorParcela,
                    valorsaldo: valorParcela, 
                    statusparcela: 'PENDENTE',
                }
            }
        },
        include: { parcelas: true, classificacoes: true }
    });
    return movimento;
}

async function consultarMovimento(id) {
    return await prisma.movimentoContas.findUnique({
        where: { idMovimentoContas: id },
        include: { fornecedorCliente: true, faturado: true, parcelas: true, classificacoes: { include: { classificacao: true } } }
    });
}

async function consultarMovimentos(filtros = {}) {
    const where = {};
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.status) where.status = filtros.status;
    if (filtros.idFornecedor) where.Pessoas_idFornecedorCliente = filtros.idFornecedor;
    if (filtros.idFaturado) where.Pessoas_idFaturado = filtros.idFaturado;
    if (filtros.numeroNotaFiscal) where.numeronotafiscal = filtros.numeroNotaFiscal;
    
    return await prisma.movimentoContas.findMany({
        where,
        include: { fornecedorCliente: true, faturado: true, parcelas: true, classificacoes: { include: { classificacao: true } } },
        orderBy: { datemissao: 'desc' }
    });
}

async function atualizarMovimento(id, dados) {
    return await prisma.movimentoContas.update({ where: { idMovimentoContas: id }, data: dados });
}

async function excluirMovimento(id) {
    try {
        await prisma.movimentoContas.delete({ where: { idMovimentoContas: id } });
        return { status: 'SUCESSO', message: 'Movimento excluído com sucesso.' };
    } catch (error) {
        return { status: 'ERRO', message: `Erro ao excluir movimento: ${error.message}` };
    }
}

// ===== OPERAÇÕES COM PARCELAS =====

async function consultarParcela(id) {
    return await prisma.parcelaContas.findUnique({ where: { idParcelasContas: id }, include: { movimento: true } });
}

async function atualizarParcela(id, dados) {
    return await prisma.parcelaContas.update({ where: { idParcelasContas: id }, data: dados });
}

async function registrarPagamentoParcela(id, valorPago) {
    const parcela = await consultarParcela(id);
    if (!parcela) throw new Error('Parcela não encontrada.');
    
    const novoSaldo = parseFloat(parcela.valorparcela) - valorPago;
    const novoStatus = novoSaldo <= 0 ? 'PAGO' : 'PENDENTE';
    
    return await atualizarParcela(id, { valorpago: valorPago, valorsaldo: novoSaldo, statusparcela: novoStatus });
}

// ===== OPERAÇÕES COM IA (PROMPTS RESTAURADOS + CORREÇÃO DE CHAVE) =====

async function classificarDespesaComGemini(descricaoProdutos) {
    try {
        // ✅ CORREÇÃO: Instancia aqui dentro
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
        
        const categorias = [
            'INSUMOS AGRÍCOLAS', 'MANUTENÇÃO E OPERAÇÃO', 'RECURSOS HUMANOS',
            'SERVIÇOS OPERACIONAIS', 'INFRAESTRUTURA E UTILIDADES', 'ADMINISTRATIVAS',
            'SEGUROS E PROTEÇÃO', 'IMPOSTOS E TAXAS', 'INVESTIMENTOS'
        ];
        
        // PROMPT COMPLETO RESTAURADO
        const prompt = `Você é um especialista em classificação de despesas agrícolas. 
        Analise a seguinte descrição de produtos/serviços e classifique em UMA das categorias disponíveis:
        
        Descrição: "${descricaoProdutos}"
        
        Categorias disponíveis:
        ${categorias.join('\n')}
        
        Responda APENAS com o nome da categoria mais adequada, sem explicações adicionais.`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const classificacao = response.text().trim();
        
        return categorias.includes(classificacao) ? classificacao : 'ADMINISTRATIVAS';
    } catch (error) {
        console.error('Erro ao classificar despesa com Gemini:', error);
        return 'ADMINISTRATIVAS';
    }
}

async function interpretarDadosComGemini(dados) {
    try {
        // ✅ CORREÇÃO: Instancia aqui dentro
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
        
        // PROMPT COMPLETO RESTAURADO
        const prompt = `Você é um especialista em análise de dados para sistemas de gestão agrícola.
        Analise os seguintes dados e determine qual operação deve ser realizada no banco de dados.
        
        Dados: ${JSON.stringify(dados, null, 2)}
        
        Operações possíveis:
        1. INSERIR - Quando os dados representam uma nova entrada que deve ser criada no sistema
        2. ATUALIZAR - Quando os dados representam uma atualização de informações já existentes
        3. EXCLUIR - Quando os dados indicam que um registro deve ser removido
        4. CONSULTAR - Quando os dados representam uma solicitação de busca de informações
        
        Responda com um JSON no seguinte formato:
        {
          "operacao": "INSERIR|ATUALIZAR|EXCLUIR|CONSULTAR",
          "entidade": "PESSOA|CLASSIFICACAO|MOVIMENTO|PARCELA",
          "justificativa": "Breve explicação da sua decisão",
          "dados_processados": { ... dados relevantes para a operação ... }
        }`;
        
        const result = await model.generateContent(prompt);
        const textoResposta = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(textoResposta);
    } catch (error) {
        console.error('Erro ao interpretar dados com Gemini:', error);
        return { operacao: 'ERRO', justificativa: `Erro na interpretação: ${error.message}` };
    }
}

async function executarOperacaoInterpretada(interpretacao) {
    // Lógica mantida, apenas roteamento
    try {
        const { operacao, entidade, dados_processados } = interpretacao;
        if (!operacao || !entidade) throw new Error('Interpretação incompleta: operação ou entidade não especificada');
        
        let resultado;
        switch (entidade) {
            case 'PESSOA':
                if (operacao === 'INSERIR' || operacao === 'ATUALIZAR') {
                    const { documento, razaoSocial, tipo, fantasia } = dados_processados;
                    resultado = await criarOuConsultarPessoa(documento, razaoSocial, tipo || 'FORNECEDOR', fantasia);
                } else if (operacao === 'EXCLUIR') {
                    resultado = await excluirPessoa(dados_processados.id);
                } else if (operacao === 'CONSULTAR') {
                    resultado = await consultarPessoa(dados_processados.documento);
                }
                break;
            case 'CLASSIFICACAO':
                if (operacao === 'INSERIR' || operacao === 'ATUALIZAR') {
                    const { descricao, tipo } = dados_processados;
                    resultado = await criarOuConsultarClassificacao(descricao, tipo || 'DESPESA');
                } else if (operacao === 'EXCLUIR') {
                    resultado = await excluirClassificacao(dados_processados.id);
                } else if (operacao === 'CONSULTAR') {
                    resultado = await consultarClassificacao(dados_processados.descricao, dados_processados.tipo);
                }
                break;
            case 'MOVIMENTO':
                if (operacao === 'INSERIR') {
                    const { data, idFornecedor, idFaturado, idClassificacao } = dados_processados;
                    resultado = await criarMovimentoEParcela(data, idFornecedor, idFaturado, idClassificacao);
                } else if (operacao === 'ATUALIZAR') {
                    resultado = await atualizarMovimento(dados_processados.id, dados_processados.dados);
                } else if (operacao === 'EXCLUIR') {
                    resultado = await excluirMovimento(dados_processados.id);
                } else if (operacao === 'CONSULTAR') {
                    if (dados_processados.id) resultado = await consultarMovimento(dados_processados.id);
                    else resultado = await consultarMovimentos(dados_processados.filtros || {});
                }
                break;
            case 'PARCELA':
                if (operacao === 'ATUALIZAR') {
                    resultado = await atualizarParcela(dados_processados.id, dados_processados.dados);
                } else if (operacao === 'CONSULTAR') {
                    resultado = await consultarParcela(dados_processados.id);
                } else if (operacao === 'PAGAR') {
                    resultado = await registrarPagamentoParcela(dados_processados.id, dados_processados.valorPago);
                }
                break;
            default:
                throw new Error(`Entidade desconhecida: ${entidade}`);
        }
        
        return { status: 'SUCESSO', resultado, mensagem: `Operação ${operacao} em ${entidade} executada com sucesso` };
    } catch (error) {
        console.error(`Erro ao executar operação interpretada: ${error.message}`);
        return { status: 'ERRO', resultado: null, mensagem: `Falha na execução: ${error.message}` };
    }
}

async function processarDadosComIA(dados) {
    try {
        console.log('🤖 Iniciando processamento de dados com IA...');
        const interpretacao = await interpretarDadosComGemini(dados);
        console.log(`✅ Interpretação concluída: ${interpretacao.operacao} em ${interpretacao.entidade}`);
        
        if (interpretacao.operacao !== 'ERRO') {
            const resultado = await executarOperacaoInterpretada(interpretacao);
            return { ...resultado, interpretacao };
        } else {
            return { status: 'ERRO', mensagem: interpretacao.justificativa, interpretacao };
        }
    } catch (error) {
        console.error('❌ Erro no processamento com IA:', error);
        return { status: 'ERRO', mensagem: `Falha no processamento com IA: ${error.message}`, interpretacao: null };
    }
}

async function analisarRiscoNotaFiscal(dadosNotaFiscal) {
    try {
        // ✅ CORREÇÃO: Instancia aqui dentro
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
        
        // PROMPT COMPLETO RESTAURADO
        const prompt = `Você é um analista de risco financeiro sênior, especializado em detectar fraudes em notas fiscais agrícolas.
        Sua tarefa é analisar os dados de uma nota e gerar um parecer em JSON com a seguinte estrutura:
        {
          "risk_score": <int, 0-10>,
          "summary": "<string, resumo da análise>",
          "red_flags": [
            {
              "type": "<string, Ex: 'SOBREPREÇO', 'INCONSISTÊNCIA DE CATEGORIA', 'FORNECEDOR INCOMUM', 'PADRÃO SUSPEITO'>",
              "description": "<string, descrição do alerta>"
            }
          ]
        }
        
        Seja rigoroso. Compare o valor pago com uma estimativa de mercado mental. Verifique se os produtos condizem com a categoria e o fornecedor.
        Procure por padrões suspeitos (valores redondos, etc.).
        
        Realize sua análise de risco com base nos dados da nota fiscal a seguir:
        ${JSON.stringify(dadosNotaFiscal, null, 2)}`;
        
        const result = await model.generateContent(prompt);
        const textoResposta = result.response.text().replace(/```json|```/g, '').trim();
        
        // Extrair o JSON da resposta
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Resposta do Gemini não contém um JSON válido');
        }
    } catch (error) {
        console.error('❌ Erro na análise de risco:', error);
        return {
            risk_score: 5,
            summary: `Não foi possível completar a análise de risco: ${error.message}`,
            red_flags: [{ type: 'ERRO_ANÁLISE', description: 'Ocorreu um erro durante a análise de risco.' }]
        };
    }
}

async function analisarPadroesTransacoes(transacoes, opcoes = {}) {
    try {
        // ✅ CORREÇÃO: Instancia aqui dentro
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
        
        // PROMPT COMPLETO RESTAURADO
        const prompt = `Você é um especialista em análise de dados financeiros e detecção de fraudes.
        Analise o seguinte conjunto de transações e identifique padrões suspeitos ou anomalias que possam indicar problemas.
        
        Transações: ${JSON.stringify(transacoes, null, 2)}
        
        Opções de análise: ${JSON.stringify(opcoes, null, 2)}
        
        Responda com um JSON no seguinte formato:
        {
          "padroes_detectados": [
            {
              "tipo": "<string, tipo do padrão detectado>",
              "descricao": "<string, descrição detalhada>",
              "confianca": <float, 0.0-1.0, nível de confiança>,
              "transacoes_relacionadas": [<ids das transações relacionadas>]
            }
          ],
          "resumo": "<string, resumo geral da análise>",
          "recomendacoes": ["<string, recomendações de ação>"],
          "score_anomalia": <float, 0.0-1.0, score geral de anomalia>
        }`;
        
        const result = await model.generateContent(prompt);
        const textoResposta = result.response.text().replace(/```json|```/g, '').trim();
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        else throw new Error('Resposta do Gemini não contém um JSON válido');

    } catch (error) {
        console.error('❌ Erro na análise de padrões:', error);
        return {
            padroes_detectados: [],
            resumo: `Não foi possível completar a análise de padrões: ${error.message}`,
            recomendacoes: ['Verificar manualmente as transações'],
            score_anomalia: 0.5
        };
    }
}

async function gerarRecomendacoesAutomaticas(dados) {
    try {
        // ✅ CORREÇÃO: Instancia aqui dentro
        if (!process.env.GEMINI_API_KEY) throw new Error("Chave não configurada");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: TEXT_MODEL });
        
        // PROMPT COMPLETO RESTAURADO
        const prompt = `Você é um consultor financeiro especializado em gestão agrícola.
        Com base nos dados fornecidos, gere recomendações estratégicas para otimizar operações financeiras e reduzir riscos.
        
        Dados: ${JSON.stringify(dados, null, 2)}
        
        Responda com um JSON no seguinte formato:
        {
          "recomendacoes": [
            {
              "categoria": "<string, categoria da recomendação>",
              "descricao": "<string, descrição detalhada>",
              "prioridade": "ALTA|MÉDIA|BAIXA",
              "impacto_estimado": "<string, descrição do impacto esperado>"
            }
          ],
          "resumo_executivo": "<string, resumo das principais recomendações>",
          "prazo_sugerido": "<string, prazo sugerido para implementação>"
        }`;
        
        const result = await model.generateContent(prompt);
        const textoResposta = result.response.text().replace(/```json|```/g, '').trim();
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        else throw new Error('Resposta do Gemini não contém um JSON válido');

    } catch (error) {
        console.error('❌ Erro ao gerar recomendações:', error);
        return {
            recomendacoes: [{ categoria: 'ERRO', descricao: `Não foi possível gerar recomendações: ${error.message}`, prioridade: 'MÉDIA', impacto_estimado: 'Indeterminado' }],
            resumo_executivo: 'Ocorreu um erro ao gerar recomendações automáticas.',
            prazo_sugerido: 'N/A'
        };
    }
}

// ===== FUNÇÕES CRUD GENÉRICAS (Para Interface de Gestão) =====

async function listarPessoas(filtros = {}) {
    const where = {};
    if (Object.keys(filtros).length === 0 || filtros.apenasAtivos) where.status = 'ATIVO';
    if (filtros.termo) {
        where.OR = [{ razaosocial: { contains: filtros.termo, mode: 'insensitive' } }, { documento: { contains: filtros.termo } }];
    }
    if (filtros.tipo) where.tipo = filtros.tipo;
    return await prisma.pessoas.findMany({ where, orderBy: { razaosocial: 'asc' } });
}

async function listarClassificacoes(filtros = {}) {
    const where = {};
    if (Object.keys(filtros).length === 0 || filtros.apenasAtivos) where.status = 'ATIVA';
    if (filtros.termo) where.descricao = { contains: filtros.termo, mode: 'insensitive' };
    if (filtros.tipo) where.tipo = filtros.tipo;
    return await prisma.classificacao.findMany({ where, orderBy: { descricao: 'asc' } });
}

async function excluirPessoaLogico(id) {
    return await prisma.pessoas.update({ where: { idPessoas: parseInt(id) }, data: { status: 'INATIVO' } });
}

async function excluirClassificacaoLogico(id) {
    return await prisma.classificacao.update({ where: { idClassificacao: parseInt(id) }, data: { status: 'INATIVO' } });
}

async function excluirMovimentoLogico(id) {
    return await prisma.movimentoContas.update({ where: { idMovimentoContas: parseInt(id) }, data: { status: 'INATIVO' } });
}

module.exports = {
    connectDb, disconnectDb,
    consultarPessoa, criarOuConsultarPessoa, atualizarPessoa, excluirPessoa,
    consultarClassificacao, criarOuConsultarClassificacao, atualizarClassificacao, excluirClassificacao,
    criarMovimentoEParcela, consultarMovimento, consultarMovimentos, atualizarMovimento, excluirMovimento,
    consultarParcela, atualizarParcela, registrarPagamentoParcela,
    classificarDespesaComGemini, interpretarDadosComGemini, executarOperacaoInterpretada, processarDadosComIA,
    analisarRiscoNotaFiscal, analisarPadroesTransacoes, gerarRecomendacoesAutomaticas,
    listarPessoas, listarClassificacoes, excluirPessoaLogico, excluirClassificacaoLogico, excluirMovimentoLogico,
    TEXT_MODEL
};