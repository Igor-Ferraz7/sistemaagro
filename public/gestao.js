// Estado da Aplicação
let currentTab = 'pessoas';
let ultimaBuscaFoiTodos = true;
let listaDadosAtuais = []; // ✅ Armazena os dados para ordenar sem ir no servidor
let ordemAtual = { coluna: null, direcao: 1 }; // 1 = Crescente, -1 = Decrescente

// Configuração das Colunas e Campos por Aba
const CONFIG = {
    pessoas: {
        api: '/api/pessoas',
        headers: ['ID', 'Nome / Razão Social', 'Documento', 'Tipo', 'Status', 'Ações'],
        // ✅ NOVO: Mapeia o índice da coluna para o campo do JSON
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
        headers: ['ID', 'NF', 'Fornecedor', 'Vencimento', 'Valor', 'Status', 'Ações'],
        sortKeys: ['idMovimentoContas', 'numeronotafiscal', 'fornecedorCliente.razaosocial', 'datemissao', 'valortotal', 'status', null],
        renderRow: (item) => {
            const valor = parseFloat(item.valortotal).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            const dataVenc = new Date(item.parcelas[0]?.datavencimento || item.datemissao).toLocaleDateString('pt-BR');
            const fornecedor = item.fornecedorCliente?.razaosocial || 'N/A';
            
            return `
                <td>${item.idMovimentoContas}</td>
                <td>${item.numeronotafiscal || 'S/N'}</td>
                <td>${fornecedor}</td>
                <td>${dataVenc}</td>
                <td><strong>${valor}</strong></td>
                <td><span class="${item.status === 'PENDENTE' ? 'status-pendente' : (item.status === 'PAGO' ? 'status-ativo' : 'status-inativo')}">${item.status}</span></td>
                <td class="actions">
                    <button class="btn btn-del" onclick="excluir(${item.idMovimentoContas})">🗑️</button>
                </td>
            `;
        },
        formFields: []
    }
};

// 1. Inicialização
document.addEventListener('DOMContentLoaded', () => {
    setupFilters();
    carregarDados(true);
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    // Reseta ordenação visual ao trocar de aba
    ordemAtual = { coluna: null, direcao: 1 };
    
    // Renderiza Headers com onclick passando o ÍNDICE da coluna
    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = CONFIG[tab].headers.map((h, index) => 
        `<th onclick="ordenar(${index})" style="cursor:pointer" title="Clique para ordenar">${h} ${getSetaOrdenacao(index)}</th>`
    ).join('');
    
    setupFilters();
    carregarDados(true);
}

function getSetaOrdenacao(index) {
    const key = CONFIG[currentTab].sortKeys[index];
    if (ordemAtual.coluna === key) {
        return ordemAtual.direcao === 1 ? '🔼' : '🔽';
    }
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

// 2. Carregar Dados (FETCH)
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
        const data = await res.json();

        if(!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align:center; padding:20px;">Nenhum registro encontrado.</td></tr>';
            listaDadosAtuais = [];
            return;
        }

        // ✅ Salva na memória global para permitir ordenação local
        listaDadosAtuais = data;
        
        // Renderiza
        renderizarTabela();

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="100%" style="color:red; text-align:center;">Erro ao carregar dados.</td></tr>';
    }
}

// ✅ NOVA FUNÇÃO: Renderiza a tabela baseada na lista em memória
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

// ✅ NOVA FUNÇÃO: Lógica de Ordenação (Indexação por Coluna)
function ordenar(colIndex) {
    const config = CONFIG[currentTab];
    const key = config.sortKeys[colIndex];

    // Se a coluna não tiver chave de ordenação (ex: Ações), ignora
    if (!key) return;

    // Inverte direção se clicar na mesma coluna
    if (ordemAtual.coluna === key) {
        ordemAtual.direcao *= -1;
    } else {
        ordemAtual.coluna = key;
        ordemAtual.direcao = 1; // Padrão: Crescente
    }

    // Atualiza as setinhas no header
    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = config.headers.map((h, index) => 
        `<th onclick="ordenar(${index})" style="cursor:pointer">${h} ${getSetaOrdenacao(index)}</th>`
    ).join('');

    // Ordena o array em memória
    listaDadosAtuais.sort((a, b) => {
        let valA = getValorProfundo(a, key);
        let valB = getValorProfundo(b, key);

        // Tratamento para nulos
        if (valA == null) valA = "";
        if (valB == null) valB = "";

        // Tratamento para números (ID, Valor)
        if (!isNaN(valA) && !isNaN(valB) && valA !== "" && valB !== "") {
            return (valA - valB) * ordemAtual.direcao;
        }

        // Tratamento para strings
        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();

        if (valA < valB) return -1 * ordemAtual.direcao;
        if (valA > valB) return 1 * ordemAtual.direcao;
        return 0;
    });

    renderizarTabela();
}

// Auxiliar para pegar valores aninhados (ex: fornecedorCliente.razaosocial)
function getValorProfundo(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// 3. Ações e Forms (Mantidos quase iguais)
function novoRegistro() {
    document.getElementById('editId').value = '';
    document.getElementById('dynamicForm').reset();
    renderEmptyForm();
    document.getElementById('modalForm').classList.add('show');
}

function editar(item) {
    const config = CONFIG[currentTab];
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    const id = item.idPessoas || item.idClassificacao;
    
    document.getElementById('editId').value = id;
    document.getElementById('modalTitle').textContent = `Editar ${currentTab} #${id}`;

    config.formFields.forEach(field => {
        let inputHtml = '';
        const value = item[field.name] || '';
        
        if(field.type === 'select') {
            const options = field.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('');
            inputHtml = `<select name="${field.name}">${options}</select>`;
        } else {
            inputHtml = `<input type="${field.type}" name="${field.name}" value="${value}" required>`;
        }
        container.innerHTML += `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
    });

    document.getElementById('modalForm').classList.add('show');
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
        } else { alert('Erro ao salvar.'); }
    } catch (error) { console.error(error); alert('Erro de conexão.'); }
});

function renderEmptyForm() {
    const config = CONFIG[currentTab];
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    document.getElementById('modalTitle').textContent = `Novo(a) ${currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}`;

    if (!config.formFields || config.formFields.length === 0) {
        container.innerHTML = '<p style="color:red; text-align:center;">Criação apenas via Upload de PDF.</p>';
        return;
    }

    config.formFields.forEach(field => {
         let inputHtml = '';
         if(field.type === 'select') {
             const options = field.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
             inputHtml = `<select name="${field.name}">${options}</select>`;
         } else {
             inputHtml = `<input type="${field.type}" name="${field.name}" required>`;
         }
         container.innerHTML += `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
    });
}

function fecharModal() { document.getElementById('modalForm').classList.remove('show'); }