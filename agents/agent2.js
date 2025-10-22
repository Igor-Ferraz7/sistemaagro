const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELO_GEMINI = "gemini-2.5-pro";
const prisma = new PrismaClient();

// Inicializa o cliente Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Função para conectar ao banco de dados
 * @returns {Promise<void>}
 */
async function connectDb() {
    await prisma.$connect();
    console.log('📊 Banco de Dados: ✅ Conectado');
}

/**
 * Função para desconectar do banco de dados
 * @returns {Promise<void>}
 */
async function disconnectDb() {
    await prisma.$disconnect();
    console.log('📊 Banco de Dados: ❌ Desconectado');
}

// ===== OPERAÇÕES COM PESSOAS (FORNECEDORES/FATURADOS) =====

/**
 * Consulta uma pessoa pelo documento (CPF/CNPJ)
 * @param {string} documento - CPF ou CNPJ (apenas números)
 * @returns {Promise<Object|null>} - Dados da pessoa ou null se não encontrada
 */
async function consultarPessoa(documento) {
    if (!documento) return null;
    
    const docLimpo = documento.replace(/\D/g, '');
    
    return await prisma.pessoas.findFirst({
        where: { documento: docLimpo }
    });
}

/**
 * Consulta ou cria uma pessoa no banco de dados
 * @param {string} documento - CPF ou CNPJ (apenas números)
 * @param {string} razaoSocial - Nome ou Razão Social
 * @param {string} tipo - 'FORNECEDOR' ou 'FATURADO'
 * @param {string} [fantasia] - Nome fantasia, se disponível
 * @returns {Promise<Object>} - Resultado da operação com status e ID
 */
async function criarOuConsultarPessoa(documento, razaoSocial, tipo, fantasia = null) {
    const docLimpo = documento ? documento.replace(/\D/g, '') : null;
    
    if (!docLimpo || !razaoSocial) {
        return {
            status: 'ERRO_DADOS',
            message: `Dados insuficientes para criar/consultar ${tipo}`
        };
    }

    let pessoa = await consultarPessoa(docLimpo);

    if (pessoa) {
        return {
            status: 'EXISTE',
            id: pessoa.idPessoas,
            data: pessoa,
            message: 'EXISTE',
            documento: docLimpo,
            razaoSocial: pessoa.razaosocial
        };
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
        return {
            status: 'CRIADO',
            id: newPessoa.idPessoas,
            data: newPessoa,
            message: 'NÃO EXISTE (CRIADO AGORA)',
            documento: docLimpo,
            razaoSocial: newPessoa.razaosocial
        };
    }
}

/**
 * Atualiza os dados de uma pessoa
 * @param {number} id - ID da pessoa
 * @param {Object} dados - Dados a serem atualizados
 * @returns {Promise<Object>} - Pessoa atualizada
 */
async function atualizarPessoa(id, dados) {
    return await prisma.pessoas.update({
        where: { idPessoas: id },
        data: dados
    });
}

/**
 * Exclui uma pessoa do banco de dados
 * @param {number} id - ID da pessoa
 * @returns {Promise<Object>} - Resultado da operação
 */
async function excluirPessoa(id) {
    try {
        // Verificar se a pessoa está sendo usada em algum movimento
        const movimentosFornecedor = await prisma.movimentoContas.count({
            where: { Pessoas_idFornecedorCliente: id }
        });
        
        const movimentosFaturado = await prisma.movimentoContas.count({
            where: { Pessoas_idFaturado: id }
        });
        
        if (movimentosFornecedor > 0 || movimentosFaturado > 0) {
            return {
                status: 'ERRO',
                message: 'Não é possível excluir esta pessoa pois está vinculada a movimentos.'
            };
        }
        
        await prisma.pessoas.delete({
            where: { idPessoas: id }
        });
        
        return {
            status: 'SUCESSO',
            message: 'Pessoa excluída com sucesso.'
        };
    } catch (error) {
        return {
            status: 'ERRO',
            message: `Erro ao excluir pessoa: ${error.message}`
        };
    }
}

// ===== OPERAÇÕES COM CLASSIFICAÇÃO =====

/**
 * Consulta uma classificação pela descrição
 * @param {string} descricao - Descrição da classificação
 * @param {string} [tipo='DESPESA'] - Tipo da classificação
 * @returns {Promise<Object|null>} - Dados da classificação ou null se não encontrada
 */
async function consultarClassificacao(descricao, tipo = 'DESPESA') {
    if (!descricao) return null;
    
    return await prisma.classificacao.findFirst({
        where: { 
            descricao: { 
                equals: descricao,
                mode: 'insensitive' 
            },
            tipo: tipo
        }
    });
}

/**
 * Consulta ou cria uma classificação no banco de dados
 * @param {string} descricao - Descrição da classificação
 * @param {string} [tipo='DESPESA'] - Tipo da classificação
 * @returns {Promise<Object>} - Resultado da operação com status e ID
 */
async function criarOuConsultarClassificacao(descricao, tipo = 'DESPESA') {
    if (!descricao) {
        return {
            status: 'ERRO_DADOS',
            message: `Descrição de ${tipo.toLowerCase()} não fornecida`
        };
    }
    
    let classificacao = await consultarClassificacao(descricao, tipo);

    if (classificacao) {
        return {
            status: 'EXISTE',
            id: classificacao.idClassificacao,
            data: classificacao,
            message: 'EXISTE'
        };
    } else {
        const newClassificacao = await prisma.classificacao.create({
            data: {
                tipo: tipo, 
                descricao: descricao,
                status: 'ATIVA'
            }
        });
        return {
            status: 'CRIADO',
            id: newClassificacao.idClassificacao,
            data: newClassificacao,
            message: 'NÃO EXISTE (CRIADO AGORA)'
        };
    }
}

/**
 * Atualiza os dados de uma classificação
 * @param {number} id - ID da classificação
 * @param {Object} dados - Dados a serem atualizados
 * @returns {Promise<Object>} - Classificação atualizada
 */
async function atualizarClassificacao(id, dados) {
    return await prisma.classificacao.update({
        where: { idClassificacao: id },
        data: dados
    });
}

/**
 * Exclui uma classificação do banco de dados
 * @param {number} id - ID da classificação
 * @returns {Promise<Object>} - Resultado da operação
 */
async function excluirClassificacao(id) {
    try {
        // Verificar se a classificação está sendo usada em algum movimento
        const movimentos = await prisma.movimentoContasClassificacao.count({
            where: { Classificacao_idClassificacao: id }
        });
        
        if (movimentos > 0) {
            return {
                status: 'ERRO',
                message: 'Não é possível excluir esta classificação pois está vinculada a movimentos.'
            };
        }
        
        await prisma.classificacao.delete({
            where: { idClassificacao: id }
        });
        
        return {
            status: 'SUCESSO',
            message: 'Classificação excluída com sucesso.'
        };
    } catch (error) {
        return {
            status: 'ERRO',
            message: `Erro ao excluir classificação: ${error.message}`
        };
    }
}

// ===== OPERAÇÕES COM MOVIMENTO DE CONTAS =====

/**
 * Cria um novo movimento de contas e sua parcela
 * @param {Object} data - Dados do movimento
 * @param {number} idFornecedor - ID do fornecedor
 * @param {number} idFaturado - ID do faturado
 * @param {number} idClassificacao - ID da classificação
 * @returns {Promise<Object>} - Movimento criado
 */
async function criarMovimentoEParcela(data, idFornecedor, idFaturado, idClassificacao) {
    // Tratamento do valor (convertendo de centavos para Decimal)
    const valorTotalReais = parseFloat(data.valor_total) / 100; 
    const dataEmissao = new Date(data.data_emissao);
    const dataVencimento = data.data_vencimento ? new Date(data.data_vencimento) : new Date(); 
    const quantidadeParcelas = data.quantidade_parcelas || 1;
    const valorParcela = valorTotalReais / quantidadeParcelas;
    const identificacaoParcela = `1/${quantidadeParcelas}`;

    if (!idFornecedor || !idFaturado || !idClassificacao || isNaN(valorTotalReais) || valorTotalReais <= 0) {
        throw new Error("Dados de Movimento, Parcela ou IDs de dependência inválidos.");
    }

    // Cria o MovimentoContas e ParcelaContas
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
            
            // Relaciona a Classificação (MovimentoContasClassificacao)
            classificacoes: {
                create: {
                    Classificacao_idClassificacao: idClassificacao 
                }
            },

            // Cria a ParcelaContas (Criação aninhada)
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
        include: {
            parcelas: true,
            classificacoes: true
        }
    });

    return movimento;
}

/**
 * Consulta um movimento pelo ID
 * @param {number} id - ID do movimento
 * @returns {Promise<Object|null>} - Dados do movimento ou null se não encontrado
 */
async function consultarMovimento(id) {
    return await prisma.movimentoContas.findUnique({
        where: { idMovimentoContas: id },
        include: {
            fornecedorCliente: true,
            faturado: true,
            parcelas: true,
            classificacoes: {
                include: {
                    classificacao: true
                }
            }
        }
    });
}

/**
 * Consulta movimentos por filtros
 * @param {Object} filtros - Filtros para a consulta
 * @returns {Promise<Array>} - Lista de movimentos
 */
async function consultarMovimentos(filtros = {}) {
    const where = {};
    
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.status) where.status = filtros.status;
    if (filtros.idFornecedor) where.Pessoas_idFornecedorCliente = filtros.idFornecedor;
    if (filtros.idFaturado) where.Pessoas_idFaturado = filtros.idFaturado;
    if (filtros.numeroNotaFiscal) where.numeronotafiscal = filtros.numeroNotaFiscal;
    
    return await prisma.movimentoContas.findMany({
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
}

/**
 * Atualiza um movimento de contas
 * @param {number} id - ID do movimento
 * @param {Object} dados - Dados a serem atualizados
 * @returns {Promise<Object>} - Movimento atualizado
 */
async function atualizarMovimento(id, dados) {
    return await prisma.movimentoContas.update({
        where: { idMovimentoContas: id },
        data: dados
    });
}

/**
 * Exclui um movimento de contas e suas parcelas
 * @param {number} id - ID do movimento
 * @returns {Promise<Object>} - Resultado da operação
 */
async function excluirMovimento(id) {
    try {
        // As parcelas e classificações serão excluídas automaticamente devido à configuração onDelete: Cascade
        await prisma.movimentoContas.delete({
            where: { idMovimentoContas: id }
        });
        
        return {
            status: 'SUCESSO',
            message: 'Movimento excluído com sucesso.'
        };
    } catch (error) {
        return {
            status: 'ERRO',
            message: `Erro ao excluir movimento: ${error.message}`
        };
    }
}

// ===== OPERAÇÕES COM PARCELAS =====

/**
 * Consulta uma parcela pelo ID
 * @param {number} id - ID da parcela
 * @returns {Promise<Object|null>} - Dados da parcela ou null se não encontrada
 */
async function consultarParcela(id) {
    return await prisma.parcelaContas.findUnique({
        where: { idParcelasContas: id },
        include: {
            movimento: true
        }
    });
}

/**
 * Atualiza uma parcela de contas
 * @param {number} id - ID da parcela
 * @param {Object} dados - Dados a serem atualizados
 * @returns {Promise<Object>} - Parcela atualizada
 */
async function atualizarParcela(id, dados) {
    return await prisma.parcelaContas.update({
        where: { idParcelasContas: id },
        data: dados
    });
}

/**
 * Registra o pagamento de uma parcela
 * @param {number} id - ID da parcela
 * @param {number} valorPago - Valor pago
 * @returns {Promise<Object>} - Parcela atualizada
 */
async function registrarPagamentoParcela(id, valorPago) {
    const parcela = await consultarParcela(id);
    
    if (!parcela) {
        throw new Error('Parcela não encontrada.');
    }
    
    const novoSaldo = parseFloat(parcela.valorparcela) - valorPago;
    const novoStatus = novoSaldo <= 0 ? 'PAGO' : 'PENDENTE';
    
    return await atualizarParcela(id, {
        valorpago: valorPago,
        valorsaldo: novoSaldo,
        statusparcela: novoStatus
    });
}

/**
 * Utiliza o Gemini para analisar e classificar uma despesa
 * @param {string} descricaoProdutos - Descrição dos produtos/serviços
 * @returns {Promise<string>} - Classificação sugerida
 */
async function classificarDespesaComGemini(descricaoProdutos) {
    try {
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });
        
        const categorias = [
            'INSUMOS AGRÍCOLAS',
            'MANUTENÇÃO E OPERAÇÃO',
            'RECURSOS HUMANOS',
            'SERVIÇOS OPERACIONAIS',
            'INFRAESTRUTURA E UTILIDADES',
            'ADMINISTRATIVAS',
            'SEGUROS E PROTEÇÃO',
            'IMPOSTOS E TAXAS',
            'INVESTIMENTOS'
        ];
        
        const prompt = `Você é um especialista em classificação de despesas agrícolas. 
        Analise a seguinte descrição de produtos/serviços e classifique em UMA das categorias disponíveis:
        
        Descrição: "${descricaoProdutos}"
        
        Categorias disponíveis:
        ${categorias.join('\n')}
        
        Responda APENAS com o nome da categoria mais adequada, sem explicações adicionais.`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const classificacao = response.text().trim();
        
        // Verificar se a classificação está entre as categorias válidas
        if (categorias.includes(classificacao)) {
            return classificacao;
        } else {
            // Retornar uma categoria padrão se a resposta não for válida
            return 'ADMINISTRATIVAS';
        }
    } catch (error) {
        console.error('Erro ao classificar despesa com Gemini:', error);
        return 'ADMINISTRATIVAS'; // Categoria padrão em caso de erro
    }
}

/**
 * Utiliza o Gemini para interpretar dados e determinar a operação necessária
 * @param {Object} dados - Dados a serem interpretados
 * @returns {Promise<Object>} - Resultado da interpretação com a operação sugerida
 */
async function interpretarDadosComGemini(dados) {
    try {
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });
        
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
        }
        `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoResposta = response.text().trim();
        
        // Extrair o JSON da resposta
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonResposta = JSON.parse(jsonMatch[0]);
            return jsonResposta;
        } else {
            throw new Error('Resposta do Gemini não contém um JSON válido');
        }
    } catch (error) {
        console.error('Erro ao interpretar dados com Gemini:', error);
        return {
            operacao: 'ERRO',
            entidade: null,
            justificativa: `Erro na interpretação: ${error.message}`,
            dados_processados: null
        };
    }
}

/**
 * Executa a operação determinada pelo Gemini
 * @param {Object} interpretacao - Resultado da interpretação do Gemini
 * @returns {Promise<Object>} - Resultado da operação executada
 */
async function executarOperacaoInterpretada(interpretacao) {
    try {
        const { operacao, entidade, dados_processados } = interpretacao;
        
        // Validar os dados da interpretação
        if (!operacao || !entidade) {
            throw new Error('Interpretação incompleta: operação ou entidade não especificada');
        }
        
        let resultado;
        
        // Executar a operação de acordo com a entidade e tipo de operação
        switch (entidade) {
            case 'PESSOA':
                if (operacao === 'INSERIR' || operacao === 'ATUALIZAR') {
                    const { documento, razaoSocial, tipo, fantasia } = dados_processados;
                    resultado = await criarOuConsultarPessoa(documento, razaoSocial, tipo || 'FORNECEDOR', fantasia);
                } else if (operacao === 'EXCLUIR') {
                    const { id } = dados_processados;
                    resultado = await excluirPessoa(id);
                } else if (operacao === 'CONSULTAR') {
                    const { documento } = dados_processados;
                    resultado = await consultarPessoa(documento);
                }
                break;
                
            case 'CLASSIFICACAO':
                if (operacao === 'INSERIR' || operacao === 'ATUALIZAR') {
                    const { descricao, tipo } = dados_processados;
                    resultado = await criarOuConsultarClassificacao(descricao, tipo || 'DESPESA');
                } else if (operacao === 'EXCLUIR') {
                    const { id } = dados_processados;
                    resultado = await excluirClassificacao(id);
                } else if (operacao === 'CONSULTAR') {
                    const { descricao, tipo } = dados_processados;
                    resultado = await consultarClassificacao(descricao, tipo || 'DESPESA');
                }
                break;
                
            case 'MOVIMENTO':
                if (operacao === 'INSERIR') {
                    const { data, idFornecedor, idFaturado, idClassificacao } = dados_processados;
                    resultado = await criarMovimentoEParcela(data, idFornecedor, idFaturado, idClassificacao);
                } else if (operacao === 'ATUALIZAR') {
                    const { id, dados } = dados_processados;
                    resultado = await atualizarMovimento(id, dados);
                } else if (operacao === 'EXCLUIR') {
                    const { id } = dados_processados;
                    resultado = await excluirMovimento(id);
                } else if (operacao === 'CONSULTAR') {
                    const { id, filtros } = dados_processados;
                    if (id) {
                        resultado = await consultarMovimento(id);
                    } else {
                        resultado = await consultarMovimentos(filtros || {});
                    }
                }
                break;
                
            case 'PARCELA':
                if (operacao === 'ATUALIZAR') {
                    const { id, dados } = dados_processados;
                    resultado = await atualizarParcela(id, dados);
                } else if (operacao === 'CONSULTAR') {
                    const { id } = dados_processados;
                    resultado = await consultarParcela(id);
                } else if (operacao === 'PAGAR') {
                    const { id, valorPago } = dados_processados;
                    resultado = await registrarPagamentoParcela(id, valorPago);
                }
                break;
                
            default:
                throw new Error(`Entidade desconhecida: ${entidade}`);
        }
        
        return {
            status: 'SUCESSO',
            resultado,
            mensagem: `Operação ${operacao} em ${entidade} executada com sucesso`
        };
    } catch (error) {
        console.error(`Erro ao executar operação interpretada: ${error.message}`);
        return {
            status: 'ERRO',
            resultado: null,
            mensagem: `Falha na execução: ${error.message}`
        };
    }
}

/**
 * Processa dados com IA para determinar e executar a operação necessária
 * @param {Object} dados - Dados a serem processados
 * @returns {Promise<Object>} - Resultado do processamento
 */
async function processarDadosComIA(dados) {
    try {
        console.log('🤖 Iniciando processamento de dados com IA...');
        
        // 1. Interpretar os dados para determinar a operação
        const interpretacao = await interpretarDadosComGemini(dados);
        console.log(`✅ Interpretação concluída: ${interpretacao.operacao} em ${interpretacao.entidade}`);
        
        // 2. Se a interpretação for bem-sucedida, executar a operação
        if (interpretacao.operacao !== 'ERRO') {
            const resultado = await executarOperacaoInterpretada(interpretacao);
            return {
                ...resultado,
                interpretacao
            };
        } else {
            return {
                status: 'ERRO',
                mensagem: interpretacao.justificativa,
                interpretacao
            };
        }
    } catch (error) {
        console.error('❌ Erro no processamento com IA:', error);
        return {
            status: 'ERRO',
            mensagem: `Falha no processamento com IA: ${error.message}`,
            interpretacao: null
        };
    }
}

/**
 * Analisa uma nota fiscal para detectar possíveis fraudes ou riscos
 * @param {Object} dadosNotaFiscal - Dados da nota fiscal a ser analisada
 * @returns {Promise<Object>} - Resultado da análise de risco em formato JSON
 */
async function analisarRiscoNotaFiscal(dadosNotaFiscal) {
    try {
        console.log('🔍 Iniciando análise de risco da nota fiscal...');
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });
        
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
        ${JSON.stringify(dadosNotaFiscal, null, 2)}
        `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoResposta = response.text().trim();
        
        // Extrair o JSON da resposta
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonResposta = JSON.parse(jsonMatch[0]);
            console.log('✅ Análise de risco concluída com sucesso');
            return jsonResposta;
        } else {
            throw new Error('Resposta do Gemini não contém um JSON válido');
        }
    } catch (error) {
        console.error('❌ Erro na análise de risco:', error);
        return {
            risk_score: 5, // Valor médio como padrão
            summary: `Não foi possível completar a análise de risco: ${error.message}`,
            red_flags: [
                {
                    type: 'ERRO_ANÁLISE',
                    description: 'Ocorreu um erro durante a análise de risco.'
                }
            ]
        };
    }
}

/**
 * Analisa histórico de transações para detectar padrões suspeitos
 * @param {Array} transacoes - Lista de transações a serem analisadas
 * @param {Object} [opcoes={}] - Opções de configuração para a análise
 * @returns {Promise<Object>} - Resultado da análise de padrões
 */
async function analisarPadroesTransacoes(transacoes, opcoes = {}) {
    try {
        console.log(`🔍 Analisando padrões em ${transacoes.length} transações...`);
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });
        
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
        }
        `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoResposta = response.text().trim();
        
        // Extrair o JSON da resposta
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonResposta = JSON.parse(jsonMatch[0]);
            console.log('✅ Análise de padrões concluída com sucesso');
            return jsonResposta;
        } else {
            throw new Error('Resposta do Gemini não contém um JSON válido');
        }
    } catch (error) {
        console.error('❌ Erro na análise de padrões:', error);
        return {
            padroes_detectados: [],
            resumo: `Não foi possível completar a análise de padrões: ${error.message}`,
            recomendacoes: ['Verificar manualmente as transações'],
            score_anomalia: 0.5 // Valor médio como padrão
        };
    }
}

/**
 * Gera recomendações de ação com base em dados financeiros e análises
 * @param {Object} dados - Dados financeiros e resultados de análises anteriores
 * @returns {Promise<Object>} - Recomendações geradas
 */
async function gerarRecomendacoesAutomaticas(dados) {
    try {
        console.log('🤖 Gerando recomendações automáticas...');
        const model = genAI.getGenerativeModel({ model: MODELO_GEMINI });
        
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
        }
        `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoResposta = response.text().trim();
        
        // Extrair o JSON da resposta
        const jsonMatch = textoResposta.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonResposta = JSON.parse(jsonMatch[0]);
            console.log('✅ Recomendações geradas com sucesso');
            return jsonResposta;
        } else {
            throw new Error('Resposta do Gemini não contém um JSON válido');
        }
    } catch (error) {
        console.error('❌ Erro ao gerar recomendações:', error);
        return {
            recomendacoes: [
                {
                    categoria: 'ERRO',
                    descricao: `Não foi possível gerar recomendações: ${error.message}`,
                    prioridade: 'MÉDIA',
                    impacto_estimado: 'Indeterminado'
                }
            ],
            resumo_executivo: 'Ocorreu um erro ao gerar recomendações automáticas.',
            prazo_sugerido: 'N/A'
        };
    }
}

module.exports = {
    // Conexão com o banco
    connectDb,
    disconnectDb,
    
    // Operações com Pessoas
    consultarPessoa,
    criarOuConsultarPessoa,
    atualizarPessoa,
    excluirPessoa,
    
    // Operações com Classificação
    consultarClassificacao,
    criarOuConsultarClassificacao,
    atualizarClassificacao,
    excluirClassificacao,
    
    // Operações com Movimento
    criarMovimentoEParcela,
    consultarMovimento,
    consultarMovimentos,
    atualizarMovimento,
    excluirMovimento,
    
    // Operações com Parcela
    consultarParcela,
    atualizarParcela,
    registrarPagamentoParcela,
    
    // Operações com IA
    classificarDespesaComGemini,
    interpretarDadosComGemini,
    executarOperacaoInterpretada,
    processarDadosComIA,
    analisarRiscoNotaFiscal,
    analisarPadroesTransacoes,
    gerarRecomendacoesAutomaticas,
    
    // Constantes
    MODELO_GEMINI
};