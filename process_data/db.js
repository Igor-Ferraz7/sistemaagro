// process_data/db.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- Funções de Conexão ---

async function connectDb() {
    await prisma.$connect();
}

async function disconnectDb() {
    await prisma.$disconnect();
}


// --- Funções de Consulta e Criação (CRUD) ---

/**
 * Consulta ou cria uma Pessoa (Fornecedor ou Faturado) no BD.
 * @param {string} documento - CPF ou CNPJ (apenas números, extraídos da IA).
 * @param {string} razaoSocial - Nome ou Razão Social.
 * @param {string} tipo - 'FORNECEDOR' ou 'FATURADO'.
 * @param {string} [fantasia] - Nome fantasia, se disponível.
 * @returns {Promise<Object>} Resultado da operação com status e ID.
 */
async function findOrCreatePessoa(documento, razaoSocial, tipo, fantasia = null) {
    // 1. FORNECEDOR/FATURADO: Deve consultar no Banco de Dados e informar se existe ou não.
    const docLimpo = documento ? documento.replace(/\D/g, '') : null;
    
    if (!docLimpo || !razaoSocial) {
        return {
            status: 'ERRO_DADOS',
            message: `Dados insuficientes para criar/consultar ${tipo}`
        };
    }

    let pessoa = await prisma.pessoas.findUnique({
        where: { documento: docLimpo }
    });

    if (pessoa) {
        // EXISTE
        return {
            status: 'EXISTE',
            id: pessoa.idPessoas,
            data: pessoa,
            message: 'EXISTE',
            documento: docLimpo,
            razaoSocial: pessoa.razaosocial
        };
    } else {
        // 2. CRIAR O NOVO FORNECEDOR/FATURADO (se for o caso)
        const newPessoa = await prisma.pessoas.create({
            data: {
                // Heurística: 14 dígitos (CNPJ) = JURIDICA. Outros (CPF) = FISICA.
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
 * Consulta ou cria uma Classificação de Despesa.
 * @param {string} descricao - Descrição da classificação.
 * @returns {Promise<Object>} Resultado da operação com status e ID.
 */
async function findOrCreateClassificacao(descricao) {
    // DESPESA: Deve consultar no Banco de Dados e informar se a classificação existe ou não.
    if (!descricao) {
        return {
            status: 'ERRO_DADOS',
            message: `Descrição de despesa não fornecida`
        };
    }
    
    let classificacao = await prisma.classificacao.findFirst({
        where: { 
            descricao: { 
                equals: descricao,
                mode: 'insensitive' 
            },
            tipo: 'DESPESA'
        }
    });

    if (classificacao) {
        // EXISTE
        return {
            status: 'EXISTE',
            id: classificacao.idClassificacao,
            data: classificacao,
            message: 'EXISTE'
        };
    } else {
        // 3. CRIAR NOVA DESPESA (se for o caso)
        const newClassificacao = await prisma.classificacao.create({
            data: {
                tipo: 'DESPESA', 
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
 * 4. CRIA UM NOVO REGISTRO DO MOVIMENTO
 */
async function createMovimentoEParcela(data, idFornecedor, idFaturado, idClassificacao) {
    
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
            tipo: 'APAGAR', // Conforme solicitado
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


module.exports = {
    findOrCreatePessoa,
    findOrCreateClassificacao,
    createMovimentoEParcela,
    connectDb,
    disconnectDb
};