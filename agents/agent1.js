const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TEXT_MODEL } = require('../geminiConfig');

// ⚠️ REMOVIDO DAQUI: A inicialização global do genAI foi removida para evitar erro de chave vazia no boot.
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const CATEGORIAS_DESPESAS = [
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processPDFWithGemini(pdfBuffer) {
    const MAX_RETRIES = 3;
    const INITIAL_BACKOFF_MS = 1000; 
    let retryCount = 0;
    let lastError = null;

    // ✅ CORREÇÃO 2: Inicialização movida para DENTRO da função.
    // Assim ele pega a chave atualizada (process.env.GEMINI_API_KEY) que você digitou na janela.
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("API Key do Gemini não configurada. Configure via interface ao iniciar.");
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    while (retryCount <= MAX_RETRIES) {
        try {
            if (retryCount > 0) {
                const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retryCount - 1);
                console.log(`🔄 Tentativa ${retryCount}/${MAX_RETRIES} após ${backoffTime}ms...`);
                await sleep(backoffTime);
            }
            
            console.log(`🤖 Processando PDF diretamente com Gemini (${TEXT_MODEL})...`);

            const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

            // --- SEU PROMPT ORIGINAL MANTIDO INTACTO ---
            const prompt = `Você é um especialista em análise de notas fiscais brasileiras (NFe). Analise este documento PDF de uma nota fiscal e extraia EXATAMENTE os seguintes dados em formato JSON válido.

INSTRUÇÕES CRÍTICAS:
- Use 'null' se a informação não for encontrada
- Para datas, use formato YYYY-MM-DD
- Para valores monetários, use apenas números (sem R$ e vírgulas, use somente ponto para separador para casas decimais, exemplo: 3012,00 vira 3012.00)
- Para CNPJ/CPF, mantenha apenas números
- Para classificação de despesa, analise os produtos/serviços e escolha UMA categoria mais adequada

ATENÇÃO ESPECIAL - NÃO CONFUNDA ESTES CAMPOS:
- NÚMERO DA NOTA FISCAL: Aparece como "NF-e N°:" ou "N°:" seguido de números (exemplo: "000.207.590")
- CNPJ DO FORNECEDOR: Formato XX.XXX.XXX/XXXX-XX (exemplo: "18.944.113/0002-91") - geralmente na seção do emitente/fornecedor
- CNPJ/CPF DO DESTINATÁRIO: Na seção "DESTINATÁRIO/REMETENTE"

ESTRUTURA TÍPICA DE UMA NFe:
1. CABEÇALHO: Contém o número da NFe (N°:)
2. EMITENTE/FORNECEDOR: Razão social, CNPJ do fornecedor
3. DESTINATÁRIO: Nome e CNPJ/CPF de quem recebe
4. PRODUTOS/SERVIÇOS: Descrição e valores
5. TOTAIS: Valor total da nota

CATEGORIAS DE DESPESAS DISPONÍVEIS:
${CATEGORIAS_DESPESAS.map((cat, index) => `${index + 1}. ${cat}`).join('\n')}

FORMATO DE RESPOSTA (JSON):
{
    "fornecedor": {
        "razao_social": "string ou null (nome da empresa emitente)",
        "fantasia": "string ou null (nome fantasia se houver)", 
        "cnpj": "apenas números ou null (CNPJ da empresa EMITENTE/FORNECEDORA)"
    },
    "faturado": {
        "nome_completo": "string ou null (nome do DESTINATÁRIO)",
        "cpf": "apenas números ou null (CPF/CNPJ do DESTINATÁRIO)"
    },
    "numero_nota_fiscal": "string ou null (número que aparece após 'N°:' ou 'NF-e N°:')",
    "data_emissao": "YYYY-MM-DD ou null",
    "descricao_produtos": "descrição detalhada dos produtos/serviços ou null",
    "quantidade_parcelas": 1,
    "data_vencimento": "YYYY-MM-DD ou null", 
    "valor_total": "número ou null (valor em centavos, ex: 344900 para R$ 3.449,00)",
    "classificacao_despesa": "uma das categorias acima ou null"
}

EXEMPLOS PARA EVITAR CONFUSÃO:
- Se vir "N°: 000.207.590", então numero_nota_fiscal = "000207590"
- Se vir CNPJ "18.944.113/0002-91" na seção do emitente, então fornecedor.cnpj = "18944113000291"
- Se vir CPF "709.046.011-88" na seção destinatário, então faturado.cpf = "70904601188"

RESPOSTA: Retorne APENAS o JSON válido, sem comentários, explicações ou formatação markdown.`;
            
            const pdfBase64 = pdfBuffer.toString('base64');

            const filePart = {
                inlineData: {
                    data: pdfBase64,
                    mimeType: 'application/pdf'
                }
            };

            const result = await model.generateContent([prompt, filePart]);
            const response = await result.response;
            let text = response.text().replace(/```json|```/g, '').trim();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                text = jsonMatch[0];
            }

            const extractedData = JSON.parse(text);
            console.log('✅ Dados processados com sucesso pelo Gemini');

            return extractedData;
        } catch (error) {
            lastError = error;
            retryCount++;
            
            const isServiceOverloaded = error.message && (
                error.message.includes('503') || 
                error.message.includes('429') || 
                error.message.includes('overloaded')
            );
            
            if (isServiceOverloaded && retryCount <= MAX_RETRIES) {
                console.log(`⚠️ Gemini API sobrecarregada. Tentando novamente (${retryCount}/${MAX_RETRIES})...`);
            } else {
                console.error('❌ Erro no processamento Gemini:', error);
                break;
            }
        }
    }
    
    throw new Error(`Falha no processamento IA após ${retryCount} tentativas: ${lastError ? lastError.message : 'Erro desconhecido'}`);
}

function getCategoryExamples(category) {
    const examples = {
        'INSUMOS AGRÍCOLAS': ['Sementes', 'Fertilizantes', 'Defensivos Agrícolas', 'Corretivos'],
        'MANUTENÇÃO E OPERAÇÃO': ['Combustíveis', 'Lubrificantes', 'Peças', 'Manutenção de Máquinas'],
        'RECURSOS HUMANOS': ['Mão de Obra Temporária', 'Salários e Encargos'],
        'SERVIÇOS OPERACIONAIS': ['Frete', 'Transporte', 'Colheita Terceirizada'],
        'INFRAESTRUTURA E UTILIDADES': ['Energia Elétrica', 'Arrendamento', 'Construções'],
        'ADMINISTRATIVAS': ['Honorários Contábeis', 'Despesas Bancárias'],
        'SEGUROS E PROTEÇÃO': ['Seguro Agrícola', 'Seguro de Ativos'],
        'IMPOSTOS E TAXAS': ['ITR', 'IPTU', 'IPVA', 'INCRA-CCIR'],
        'INVESTIMENTOS': ['Máquinas', 'Implementos', 'Veículos', 'Imóveis']
    };

    return examples[category] || [];
}

module.exports = {
    processPDFWithGemini,
    TEXT_MODEL,
    CATEGORIAS_DESPESAS,
    getCategoryExamples
};