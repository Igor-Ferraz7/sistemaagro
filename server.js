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


const { 
    listarPessoas, listarClassificacoes, 
    excluirPessoaLogico, excluirClassificacaoLogico, excluirMovimentoLogico,
    atualizarPessoa, atualizarClassificacao,
    criarOuConsultarPessoa, criarOuConsultarClassificacao,
    consultarMovimentos
} = require('./agents/agent2');

// Módulo de Persistência (BD)
const {
    findOrCreatePessoa,
    findOrCreateClassificacao,
    createMovimentoEParcela,
    connectDb,
    disconnectDb
} = require('./process_data/db');

// Importar o agente RAG Embeddings
const { consultarRAG_Embedding } = require('./agents/agent_rag_embedding');
// Importar o agente RAG Simples
const { consultarRAG } = require('./agents/agent_rag');

// Importar o script de ingestão (VITAL: Cria e Mantém o índice vetorial)
const { ingestaoInicial } = require('./process_data/ingest_embeddings');

const app = express();
const port = 3000;

// Middleware para servir arquivos estáticos e processar JSON
app.use(express.static('public'));
app.use(express.json()); // Necessário para as rotas /consultar

// Rota de teste
app.get('/test', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Extractor NF API',
        gemini_key_configured: !!process.env.GEMINI_API_KEY
    });
});

// ------------------------------------------
// ROTAS RAG
// ------------------------------------------

// Rota para consultas RAG SIMPLES (Busca SQL)
app.post('/consultar', express.json(), async (req, res) => {
    try {
        const { pergunta } = req.body;
        if (!pergunta) {
            return res.status(400).json({ sucesso: false, erro: 'Campo "pergunta" é obrigatório' });
        }
        const resultado = await consultarRAG(pergunta);
        res.json(resultado);
    } catch (error) {
        console.error('❌ Erro na rota /consultar:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});


// Rota para consultas RAG EMBEDDINGS (Busca Vetorial)
app.post('/consultar-embedding', express.json(), async (req, res) => {
    try {
        const { pergunta } = req.body;
        if (!pergunta) {
            return res.status(400).json({ sucesso: false, erro: 'Campo "pergunta" é obrigatório' });
        }
        const resultado = await consultarRAG_Embedding(pergunta);
        res.json(resultado);
    } catch (error) {
        console.error('❌ Erro na rota /consultar-embedding:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ------------------------------------------
// ROTA DE EXTRAÇÃO DE PDF
// ------------------------------------------

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

// Rota principal para extração e lançamento de dados
app.post('/extract-data', upload.single('invoice'), async (req, res) => {
    const startTime = Date.now();
    let extractedData = null;
    let dbAnalysis = {};

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo PDF enviado.' });
        }
        if (!process.env.GEMINI_API_KEY) {
            return res.status(503).json({ success: false, error: 'Chave da API do Gemini não configurada no arquivo .env.' });
        }

        console.log('🚀 Iniciando processamento...');

        // 1. EXTRAÇÃO DE DADOS (GEMINI API)
        try {
            extractedData = await processPDFWithGemini(req.file.buffer);
        } catch (aiError) {
            console.warn('⚠️ Falha na extração com IA, usando dados de fallback:', aiError.message);
            // ... (Dados de fallback omitidos por brevidade)
            extractedData = {
                fornecedor: {
                    razao_social: "DADOS TEMPORÁRIOS - GEMINI INDISPONÍVEL",
                    fantasia: "FALLBACK",
                    cnpj: req.body.cnpj_fornecedor || "00000000000000"
                },
                faturado: {
                    nome_completo: req.body.nome_faturado || "USUÁRIO TEMPORÁRIO",
                    cpf: req.body.cpf_faturado || "00000000000"
                },
                numero_nota_fiscal: req.body.numero_nf || "TEMPORÁRIO",
                data_emissao: new Date().toISOString().split('T')[0],
                descricao_produtos: "Dados temporários devido à indisponibilidade do serviço Gemini",
                quantidade_parcelas: 1,
                data_vencimento: new Date().toISOString().split('T')[0],
                valor_total: req.body.valor_total || 0,
                classificacao_despesa: req.body.classificacao || "ADMINISTRATIVAS"
            };
        }

        // 2. ANÁLISE E PERSISTÊNCIA NO BANCO DE DADOS

        // A. FORNECEDOR
        const fornecedorResult = await findOrCreatePessoa(
            extractedData.fornecedor.cnpj,
            extractedData.fornecedor.razao_social,
            'FORNECEDOR',
            extractedData.fornecedor.fantasia
        );
        dbAnalysis.fornecedor = fornecedorResult;

        // B. FATURADO
        const faturadoResult = await findOrCreatePessoa(
            extractedData.faturado.cpf,
            extractedData.faturado.nome_completo,
            'FATURADO'
        );
        dbAnalysis.faturado = faturadoResult;

        // C. DESPESA
        const despesaResult = await findOrCreateClassificacao(
            extractedData.classificacao_despesa
        );
        dbAnalysis.despesa = despesaResult;

        // D. CRIAÇÃO DE MOVIMENTO
        if (fornecedorResult.id && faturadoResult.id && despesaResult.id) {
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

            // ⚠️ GATILHO: Re-ingestão após novo movimento ser criado
            console.log('🔄 Novo Movimento lançado. Reindexando Embeddings...');
            await ingestaoInicial(); // <--- CHAMA INGESTÃO APÓS UM NOVO DADO SER INSERIDO
        } else {
            dbAnalysis.movimento = {
                status: 'FALHA_CRIACAO',
                message: 'Falha na criação do Movimento. IDs de Fornecedor, Faturado ou Classificação não foram resolvidos.'
            };
        }

        // 3. RETORNO DA RESPOSTA
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🎉 Processamento e Lançamento concluído em ${totalTime}s`);
        const isFallback = extractedData.fornecedor.razao_social === "DADOS TEMPORÁRIOS - GEMINI INDISPONÍVEL";

        res.json({
            success: true,
            method: 'direct_pdf_processing_with_db_launch',
            data: extractedData,
            dbAnalysis: dbAnalysis,
            fallback: isFallback,
            fallbackMessage: isFallback ? "O serviço Gemini está temporariamente indisponível. Os dados exibidos são temporários. Por favor, tente novamente mais tarde." : null,
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


// Middleware de tratamento de erros do Multer
app.use((error, req, res, next) => {
    // ... (tratamento de erro do Multer omitido por brevidade)
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'Arquivo muito grande. Máximo 15MB permitido para PDFs.' });
        }
    }

    if (error.message.includes('apenas arquivos PDF')) {
        return res.status(400).json({ success: false, error: error.message });
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

// ------------------------------------------
// INICIALIZAÇÃO
// ------------------------------------------

// Inicialização segura com conexão ao BD
async function main() {
    // 1. Configurar o banco de dados antes de conectar
    const dbSetupSuccess = await setupDatabase();
    if (!dbSetupSuccess) {
        console.error('❌ Falha na configuração do banco de dados. Encerrando aplicação.');
        process.exit(1);
    }

    // 2. Conectar ao BD
    await connectDb();

    // 3. CHAMADA DO PROCESSO DE INGESTÃO (CRIA O ÍNDICE VETORIAL NA INICIALIZAÇÃO)
    await ingestaoInicial();

    // 4. Iniciar o Servidor
    app.listen(port, () => {
        console.log('='.repeat(60));
        console.log('🚀 SISTEMA DE EXTRAÇÃO DE DADOS DE NOTAS FISCAIS');
        console.log('='.repeat(60));
        console.log(`🌐 Servidor: http://localhost:${port}`);
        console.log(`🔑 API Gemini: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ Não configurada'}`);
        console.log(`📊 Categorias: ${CATEGORIAS_DESPESAS.length} disponíveis`);
        console.log('📦 Banco de Dados: ✅ Conectado');
        console.log('🧠 RAG Embeddings: ✅ Índice Vetorial Pronto'); // Status de Verificação
        console.log('='.repeat(60));

        if (!process.env.GEMINI_API_KEY) {
            console.log('⚠️  ATENÇÃO: Configure a API key do Gemini no arquivo .env');
        }
    });
}

// --- ROTAS DA API DE GESTÃO (CRUD) ---

// 1. PESSOAS
app.get('/api/pessoas', async (req, res) => {
    try {
        const filtros = {
            termo: req.query.termo,
            tipo: req.query.tipo,
            apenasAtivos: req.query.todos === 'true' // Regra C
        };
        const dados = await listarPessoas(filtros);
        res.json(dados);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pessoas', async (req, res) => {
    try {
        // Regra G: CREATE status oculto == ATIVO (Já é padrão no agent2 ou forçamos aqui)
        const { documento, razaosocial, tipo, fantasia } = req.body;
        const resultado = await criarOuConsultarPessoa(documento, razaosocial, tipo, fantasia);
        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pessoas/:id', async (req, res) => {
    try {
        // Regra H: UPDATE status oculto (não passamos status no body, mantemos o atual)
        const id = parseInt(req.params.id);
        const dados = req.body; 
        delete dados.status; // Segurança: remove status se vier no body
        const resultado = await atualizarPessoa(id, dados);
        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pessoas/:id', async (req, res) => {
    try {
        // Regra I: DELETE altera status == INATIVO
        const id = parseInt(req.params.id);
        await excluirPessoaLogico(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. CLASSIFICAÇÃO (Repete a lógica)
app.get('/api/classificacoes', async (req, res) => {
    try {
        const filtros = {
            termo: req.query.termo,
            tipo: req.query.tipo,
            apenasAtivos: req.query.todos === 'true'
        };
        const dados = await listarClassificacoes(filtros);
        res.json(dados);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/classificacoes', async (req, res) => {
    try {
        const { descricao, tipo } = req.body;
        const resultado = await criarOuConsultarClassificacao(descricao, tipo);
        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/classificacoes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const dados = req.body;
        delete dados.status;
        const resultado = await atualizarClassificacao(id, dados);
        res.json(resultado);        
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/classificacoes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await excluirClassificacaoLogico(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message });}
});

app.get('/api/contas', async (req, res) => {
    try {
        // Mapeando os filtros do front para o back
        const filtros = {};
        
        // Regra C: Se não pedir todos, traz apenas ativos (ou pendentes/pagos, mas não inativos)
        if (req.query.todos !== 'true') {
            filtros.status = 'PENDENTE'; // Ou remova essa linha se quiser trazer tudo exceto INATIVO
        }
        
        // Nota: A busca por texto (termo) em movimentos é complexa (envolve joins). 
        // Por simplicidade inicial, vamos filtrar apenas por status/tipo se houver.
        if (req.query.tipo) filtros.tipo = req.query.tipo;

        const dados = await consultarMovimentos(filtros);
        
        // Filtragem manual simples por termo (caso o usuário digite nome do fornecedor)
        // Isso evita criar uma query complexa no agent2 agora.
        let resultado = dados;
        if (req.query.termo) {
            const termo = req.query.termo.toLowerCase();
            resultado = dados.filter(m => 
                (m.numeronotafiscal && m.numeronotafiscal.includes(termo)) ||
                (m.fornecedorCliente?.razaosocial && m.fornecedorCliente.razaosocial.toLowerCase().includes(termo))
            );
        }

        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/contas/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await excluirMovimentoLogico(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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