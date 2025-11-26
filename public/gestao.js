// Estado da Aplicação
let currentTab = 'pessoas';
let ultimaBuscaFoiTodos = true;
let listaDadosAtuais = [];
let ordemAtual = { coluna: null, direcao: 1 };

// Armazena dados auxiliares para os Selects (Dropdowns)
let cacheDados = {
    pessoas: [],
    classificacoes: []
};

// Configuração das Colunas e Campos
const CONFIG = {
    pessoas: {
        api: '/api/pessoas',
        headers: ['ID', 'Nome / Razão Social', 'Documento', 'Tipo', 'Status', 'Ações'],
        sortKeys: ['idPessoas', 'razaosocial', 'documento', 'tipo', 'status', null],
        renderRow: (item) => `
            <td>${item.idPessoas}</td>
            <td>${item.razaosocial || ''} <small style="color:gray">${item.fantasia ? '('+item.fantasia+')' : ''}</small></td>
            <td>${item.documento}</td>
            <td>${item.tipo}</td>
            <td><span class="${item.status === 'ATIVO' ? 'status-ativo' : 'status-inativo'}">${item.status}</span></td>
            <td class="actions">
                <button class="btn btn-edit" onclick='editar(${JSON.stringify(item)})'>✏️</button>
                <button class="btn btn-del" onclick="excluir(${item.idPessoas})">🗑️</button>
            </td>
        `,
        formFields: [
            { label: 'Razão Social / Nome', name: 'razaosocial', type: 'text' },
            { label: 'Nome Fantasia', name: 'fantasia', type: 'text' },
            { label: 'Documento (CPF/CNPJ)', name: 'documento', type: 'text' },
            { label: 'Tipo', name: 'tipo', type: 'select', options: ['FORNECEDOR', 'CLIENTE', 'FATURADO'] }
        ]
    },
    classificacao: {
        api: '/api/classificacoes',
        headers: ['ID', 'Descrição', 'Tipo', 'Status', 'Ações'],
        sortKeys: ['idClassificacao', 'descricao', 'tipo', 'status', null],
        renderRow: (item) => `
            <td>${item.idClassificacao}</td>
            <td>${item.descricao}</td>
            <td>${item.tipo}</td>
            <td><span class="${item.status === 'ATIVA' || item.status === 'ATIVO' ? 'status-ativo' : 'status-inativo'}">${item.status}</span></td>
            <td class="actions">
                <button class="btn btn-edit" onclick='editar(${JSON.stringify(item)})'>✏️</button>
                <button class="btn btn-del" onclick="excluir(${item.idClassificacao})">🗑️</button>
            </td>
        `,
        formFields: [
            { label: 'Descrição', name: 'descricao', type: 'text' },
            { label: 'Tipo', name: 'tipo', type: 'select', options: ['DESPESA', 'RECEITA'] }
        ]
    },
    contas: {
        api: '/api/contas',
        headers: ['ID', 'NF', 'Fornecedor', 'Emissão', 'Valor', 'Status', 'Ações'],
        sortKeys: ['idMovimentoContas', 'numeronotafiscal', 'fornecedorCliente.razaosocial', 'datemissao', 'valortotal', 'status', null],
        renderRow: (item) => {
            const valor = parseFloat(item.valortotal).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            const dataEmissao = new Date(item.datemissao).toLocaleDateString('pt-BR');
            const fornecedor = item.fornecedorCliente?.razaosocial || 'N/A';
            
            return `
                <td>${item.idMovimentoContas}</td>
                <td>${item.numeronotafiscal || 'S/N'}</td>
                <td>${fornecedor}</td>
                <td>${dataEmissao}</td>
                <td><strong>${valor}</strong></td>
                <td><span class="${item.status === 'PENDENTE' ? 'status-pendente' : (item.status === 'PAGO' ? 'status-ativo' : 'status-inativo')}">${item.status}</span></td>
                <td class="actions">
                    <button class="btn btn-edit" onclick='editar(${JSON.stringify(item)})'>✏️</button>
                    <button class="btn btn-del" onclick="excluir(${item.idMovimentoContas})">🗑️</button>
                </td>
            `;
        },
        // Campos para criação de conta.
        // 'source' indica de onde vem os dados para popular o select
        formFields: [
            { label: 'Número NF', name: 'numeronotafiscal', type: 'text' },
            { label: 'Fornecedor', name: 'idFornecedor', type: 'select', source: 'fornecedores' },
            { label: 'Faturado Para', name: 'idFaturado', type: 'select', source: 'faturados' },
            { label: 'Classificação', name: 'idClassificacao', type: 'select', source: 'classificacoes' },
            { label: 'Data Emissão', name: 'datemissao', type: 'date' },
            { label: 'Valor Total (R$)', name: 'valortotal', type: 'number', step: '0.01' },
            { label: 'Descrição', name: 'descricao', type: 'text' },
            { label: 'Status', name: 'status', type: 'select', options: ['PENDENTE', 'PAGO', 'CANCELADO'] } // Usado só na edição
        ]
    }
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosAuxiliares(); // Carrega listas para os dropdowns
    setupFilters();
    carregarDados(true);
});

// Carrega Pessoas e Classificações para usar nos selects de "Contas"
async function carregarDadosAuxiliares() {
    try {
        const [resPessoas, resClasses] = await Promise.all([
            fetch('/api/pessoas?todos=true'),
            fetch('/api/classificacoes?todos=true')
        ]);
        
        cacheDados.pessoas = await resPessoas.json();
        cacheDados.classificacoes = await resClasses.json();
        console.log("Dados auxiliares carregados.", cacheDados);
    } catch (e) {
        console.error("Erro ao carregar dados auxiliares:", e);
    }
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    ordemAtual = { coluna: null, direcao: 1 };
    
    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = CONFIG[tab].headers.map((h, index) => 
        `<th onclick="ordenar(${index})" style="cursor:pointer" title="Clique para ordenar">${h} ${getSetaOrdenacao(index)}</th>`
    ).join('');
    
    setupFilters();
    carregarDados(true);
}

function getSetaOrdenacao(index) {
    const key = CONFIG[currentTab].sortKeys[index];
    if (ordemAtual.coluna === key) return ordemAtual.direcao === 1 ? '🔼' : '🔽';
    return '';
}

function setupFilters() {
    const select = document.getElementById('typeFilter');
    select.innerHTML = '<option value="">Todos os Tipos</option>';
    
    if(currentTab === 'pessoas') {
        ['FORNECEDOR', 'CLIENTE', 'FATURADO'].forEach(opt => select.innerHTML += `<option value="${opt}">${opt}</option>`);
    } else if (currentTab === 'classificacao') {
        ['RECEITA', 'DESPESA'].forEach(opt => select.innerHTML += `<option value="${opt}">${opt}</option>`);
    }
}

// --- CARREGAMENTO E RENDERIZAÇÃO ---
async function carregarDados(todos = false) {
    ultimaBuscaFoiTodos = todos;
    const termo = document.getElementById('searchInput').value;
    const tipo = document.getElementById('typeFilter').value;
    const config = CONFIG[currentTab];
    const tbody = document.getElementById('tableBody');
    
    tbody.innerHTML = '<tr><td colspan="100%" style="text-align:center; padding:20px;">Carregando...</td></tr>';

    try {
        let url = `${config.api}?t=${Date.now()}`;
        if(todos) url += '&todos=true';
        if(termo) url += `&termo=${encodeURIComponent(termo)}`;
        if(tipo) url += `&tipo=${tipo}`;

        const res = await fetch(url);
        
        // Tenta ler a resposta
        let data;
        const textoResposta = await res.text(); // Lê como texto primeiro para debug

        try {
            data = JSON.parse(textoResposta);
        } catch (e) {
            console.error("Erro ao fazer parse do JSON:", textoResposta);
            throw new Error(`O servidor retornou um erro não-JSON (Provavelmente 500 ou 404). Veja o console.`);
        }

        // Verifica se a resposta da API contém erro explícito
        if (!res.ok || data.error) {
            throw new Error(data.error || `Erro do Servidor: ${res.status} ${res.statusText}`);
        }

        if(!Array.isArray(data)) {
            throw new Error("Formato de dados inválido recebido do servidor.");
        }

        if(data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align:center; padding:20px;">Nenhum registro encontrado.</td></tr>';
            listaDadosAtuais = [];
            return;
        }

        listaDadosAtuais = data;
        renderizarTabela();

    } catch (error) {
        console.error("Erro detalhado:", error);
        // AGORA VAI MOSTRAR O ERRO REAL NA TELA
        tbody.innerHTML = `<tr><td colspan="100%" style="color:red; text-align:center; padding:20px;">Erro: ${error.message}</td></tr>`;
    }
}

function renderizarTabela() {
    const tbody = document.getElementById('tableBody');
    const config = CONFIG[currentTab];
    tbody.innerHTML = '';

    listaDadosAtuais.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = config.renderRow(item);
        tbody.appendChild(tr);
    });
}

function ordenar(colIndex) {
    const config = CONFIG[currentTab];
    const key = config.sortKeys[colIndex];
    if (!key) return;

    if (ordemAtual.coluna === key) ordemAtual.direcao *= -1;
    else { ordemAtual.coluna = key; ordemAtual.direcao = 1; }

    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = config.headers.map((h, index) => `<th onclick="ordenar(${index})" style="cursor:pointer">${h} ${getSetaOrdenacao(index)}</th>`).join('');

    listaDadosAtuais.sort((a, b) => {
        let valA = getValorProfundo(a, key);
        let valB = getValorProfundo(b, key);
        if (valA == null) valA = ""; if (valB == null) valB = "";
        if (!isNaN(valA) && !isNaN(valB) && valA !== "" && valB !== "") return (valA - valB) * ordemAtual.direcao;
        valA = valA.toString().toLowerCase(); valB = valB.toString().toLowerCase();
        if (valA < valB) return -1 * ordemAtual.direcao;
        if (valA > valB) return 1 * ordemAtual.direcao;
        return 0;
    });

    renderizarTabela();
}

function getValorProfundo(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// --- FORMULÁRIOS E MODAL ---

// Gera o HTML de um Select preenchido
function gerarSelectHtml(field, valorAtual = null) {
    let optionsHtml = '';
    
    // Caso 1: Opções estáticas (Array simples)
    if (field.options) {
        optionsHtml = field.options.map(opt => 
            `<option value="${opt}" ${String(valorAtual) === String(opt) ? 'selected' : ''}>${opt}</option>`
        ).join('');
    } 
    // Caso 2: Dados dinâmicos (Source)
    else if (field.source) {
        let lista = [];
        if (field.source === 'fornecedores') {
            lista = cacheDados.pessoas; // Pega todos, idealmente filtrar por 'FORNECEDOR'
        } else if (field.source === 'faturados') {
            lista = cacheDados.pessoas.filter(p => p.tipo === 'FATURADO' || p.tipo === 'FISICA'); // Exemplo de filtro
            if(lista.length === 0) lista = cacheDados.pessoas; // Fallback
        } else if (field.source === 'classificacoes') {
            lista = cacheDados.classificacoes;
        }

        optionsHtml = lista.map(item => {
            // Determina ID e Label baseado no tipo de objeto
            const id = item.idPessoas || item.idClassificacao;
            const label = item.razaosocial || item.descricao;
            return `<option value="${id}" ${String(valorAtual) === String(id) ? 'selected' : ''}>${label}</option>`;
        }).join('');
    }

    return `<select name="${field.name}" ${field.readOnly ? 'disabled' : ''} required>
                <option value="">Selecione...</option>
                ${optionsHtml}
            </select>`;
}

function novoRegistro() {
    document.getElementById('editId').value = '';
    document.getElementById('dynamicForm').reset();
    renderForm(null); // Null indica criação
    document.getElementById('modalForm').classList.add('show');
}

function editar(item) {
    document.getElementById('editId').value = item.idPessoas || item.idClassificacao || item.idMovimentoContas;
    renderForm(item); // Passa o item para preencher
    document.getElementById('modalForm').classList.add('show');
}

function renderForm(item) {
    const config = CONFIG[currentTab];
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    
    const isEdit = !!item;
    document.getElementById('modalTitle').textContent = isEdit ? 
        `Editar ${currentTab.slice(0, -1)}` : 
        `Novo(a) ${currentTab.slice(0, -1)}`;

    config.formFields.forEach(field => {
        // Se for edição e o campo não deve aparecer (ex: status na criação), podemos filtrar aqui
        // Para simplificar, mostramos tudo configurado.
        
        let valorAtual = item ? item[field.name] : '';
        
        // Ajuste específico para Contas (Fks vêm em objetos aninhados na listagem, mas precisamos do ID no form)
        if (currentTab === 'contas' && isEdit) {
            if (field.name === 'idFornecedor') valorAtual = item.Pessoas_idFornecedorCliente;
            if (field.name === 'idFaturado') valorAtual = item.Pessoas_idFaturado;
            if (field.name === 'idClassificacao') {
                // Movimento tem array de classificações, pegamos a primeira
                valorAtual = item.classificacoes[0]?.Classificacao_idClassificacao;
            }
            if (field.name === 'datemissao' && valorAtual) {
                valorAtual = new Date(valorAtual).toISOString().split('T')[0];
            }
        }

        let inputHtml = '';
        
        if (field.type === 'select') {
            inputHtml = gerarSelectHtml(field, valorAtual);
        } else {
            inputHtml = `<input type="${field.type}" name="${field.name}" value="${valorAtual || ''}" step="${field.step || 'any'}" required>`;
        }
        
        container.innerHTML += `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
    });
}

async function excluir(id) {
    if(!confirm('Deseja realmente inativar este registro?')) return;
    const config = CONFIG[currentTab];
    try {
        const res = await fetch(`${config.api}/${id}`, { method: 'DELETE' });
        if(res.ok) carregarDados(ultimaBuscaFoiTodos); 
        else alert('Erro ao excluir.');
    } catch (e) { console.error(e); alert('Erro de conexão.'); }
}

document.getElementById('dynamicForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = CONFIG[currentTab];
    const id = document.getElementById('editId').value;
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${config.api}/${id}` : config.api;

    try {
        const res = await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        
        if(res.ok) {
            alert('Salvo com sucesso!');
            fecharModal();
            carregarDados(ultimaBuscaFoiTodos);
        } else { 
            const err = await res.json();
            alert('Erro ao salvar: ' + (err.error || 'Erro desconhecido')); 
        }
    } catch (error) { console.error(error); alert('Erro de conexão.'); }
});

function fecharModal() { document.getElementById('modalForm').classList.remove('show'); }
