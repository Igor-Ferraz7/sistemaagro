const express = require('express');
const multer = require('multer');
require('dotenv').config();

// Módulos do Agente (Gemini)
const { 
    processPDFWithGemini, 
    MODELO_GEMINI, 
    CATEGORIAS_DESPESAS,
    getCategoryExamples 
} = require('./agents/agent1'); 

// Módulo de Persistência (BD) - NOVO ARQUIVO
const {
    findOrCreatePessoa,
    findOrCreateClassificacao,
    createMovimentoEParcela,
    connectDb,
    disconnectDb
} = require('./process_data/db'); 

const app = express();
const port = 3000;

// Configuração do Multer para upload de PDFs
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 15 * 1024 * 1024 // 15MB para PDFs
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos para extração de dados de notas fiscais.'));
        }
    }
});

// Middleware para servir arquivos estáticos
app.use(express.static('public'));
app.use(express.json());

// Rota de teste
app.get('/test', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Extractor NF API',
        gemini_key_configured: !!process.env.GEMINI_API_KEY
    });
});

// Rota principal para extração e lançamento de dados
app.post('/extract-data', upload.single('invoice'), async (req, res) => {
    const startTime = Date.now();
    let extractedData = null;
    let dbAnalysis = {}; 

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF enviado.'
            });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(503).json({
                success: false,
                error: 'Chave da API do Gemini não configurada no arquivo .env.'
            });
        }

        console.log('🚀 Iniciando processamento...');
        console.log(`- Arquivo: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

        // 1. EXTRAÇÃO DE DADOS (GEMINI API)
        extractedData = await processPDFWithGemini(req.file.buffer);

        // 2. ANÁLISE E PERSISTÊNCIA NO BANCO DE DADOS
        
        // A. FORNECEDOR
        console.log('🔍 Analisando Fornecedor...');
        const fornecedorResult = await findOrCreatePessoa(
            extractedData.fornecedor.cnpj,
            extractedData.fornecedor.razao_social,
            'FORNECEDOR',
            extractedData.fornecedor.fantasia
        );
        dbAnalysis.fornecedor = fornecedorResult;

        // B. FATURADO
        console.log('🔍 Analisando Faturado...');
        const faturadoResult = await findOrCreatePessoa(
            extractedData.faturado.cpf, 
            extractedData.faturado.nome_completo,
            'FATURADO'
        );
        dbAnalysis.faturado = faturadoResult;

        // C. DESPESA
        console.log('🔍 Analisando Classificação...');
        const despesaResult = await findOrCreateClassificacao(
            extractedData.classificacao_despesa
        );
        dbAnalysis.despesa = despesaResult;
        
        // D. CRIAÇÃO DE MOVIMENTO (4. CRIAR UM NOVO REGISTRO DO MOVIMENTO)
        if (fornecedorResult.id && faturadoResult.id && despesaResult.id) {
            console.log('💾 Lançando Movimento e Parcela...');
            const movimento = await createMovimentoEParcela(
                extractedData,
                fornecedorResult.id,
                faturadoResult.id,
                despesaResult.id
            );
            dbAnalysis.movimento = {
                status: 'CRIADO_SUCESSO',
                message: `5. INFORMAR AO USUÁRIO QUE REGISTRO FOI LANÇADO COM SUCESSO.`,
                id: movimento.idMovimentoContas,
                parcelaId: movimento.parcelas[0].idParcelasContas
            };
        } else {
            dbAnalysis.movimento = {
                status: 'FALHA_CRIACAO',
                message: 'Falha na criação do Movimento. IDs de Fornecedor, Faturado ou Classificação não foram resolvidos.'
            };
        }
        
        // 3. RETORNO DA RESPOSTA
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🎉 Processamento e Lançamento concluído em ${totalTime}s`);

        res.json({
            success: true,
            method: 'direct_pdf_processing_with_db_launch',
            data: extractedData,
            dbAnalysis: dbAnalysis, 
            metadata: {
                filename: req.file.originalname,
                fileSize: req.file.size,
                processingTime: `${totalTime}s`,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Erro durante o processamento:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro interno do servidor durante a extração/lançamento.'
        });
    }
});

// Middleware de tratamento de erros do Multer (se houver)
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Arquivo muito grande. Máximo 15MB permitido para PDFs.'
            });
        }
    }

    if (error.message.includes('apenas arquivos PDF')) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    console.error('Erro não tratado:', error);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
    });
});

// Importar o script de configuração do banco de dados
const { setupDatabase } = require('./prisma/setup-db');

// Inicialização segura com conexão ao BD
async function main() {
    // Configurar o banco de dados antes de conectar
    const dbSetupSuccess = await setupDatabase();
    if (!dbSetupSuccess) {
        console.error('❌ Falha na configuração do banco de dados. Encerrando aplicação.');
        process.exit(1);
    }
    
    await connectDb();
    
    app.listen(port, () => {
        console.log('='.repeat(60));
        console.log('🚀 SISTEMA DE EXTRAÇÃO DE DADOS DE NOTAS FISCAIS');
        console.log('='.repeat(60));
        console.log(`🌐 Servidor: http://localhost:${port}`);
        console.log(`🔑 API Gemini: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ Não configurada'}`);
        console.log(`📊 Categorias: ${CATEGORIAS_DESPESAS.length} disponíveis`);
        console.log('📦 Banco de Dados: ✅ Conectado');
        console.log('='.repeat(60));

        if (!process.env.GEMINI_API_KEY) {
            console.log('⚠️  ATENÇÃO: Configure a API key do Gemini no arquivo .env');
        }
    });
}

// Fechamento seguro da conexão com o BD ao sair
process.on('SIGINT', async () => {
    await disconnectDb();
    console.log('🛑 Servidor encerrado. Conexão com o BD fechada.');
    process.exit(0);
});

main().catch(e => {
    console.error(e);
    process.exit(1);
});