// Estado da Aplicação
let currentTab = 'pessoas';
let ultimaBuscaFoiTodos = true; // <--- NOVO: Guarda o estado da última busca

// Configuração das Colunas e Campos por Aba
const CONFIG = {
    pessoas: {
        api: '/api/pessoas',
        headers: ['ID', 'Nome / Razão Social', 'Documento', 'Tipo', 'Status', 'Ações'],
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
    carregarDados(true); // Carrega inicial
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = CONFIG[tab].headers.map(h => `<th>${h}</th>`).join('');
    
    setupFilters();
    carregarDados(true); // Reset ao trocar de aba
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

// 2. Carregar Dados
async function carregarDados(todos = false) {
    ultimaBuscaFoiTodos = todos; // <--- ATUALIZA O ESTADO

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

        tbody.innerHTML = '';
        if(!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align:center; padding:20px;">Nenhum registro encontrado.</td></tr>';
            return;
        }

        data.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = config.renderRow(item);
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="100%" style="color:red; text-align:center;">Erro ao carregar dados.</td></tr>';
    }
}

// 3. Ações
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
            inputHtml = `<input type="${field.type}" name="${field.name}" value="${value}">`;
        }
        container.innerHTML += `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
    });

    abrirModal();
}

async function excluir(id) {
    if(!confirm('Deseja realmente inativar este registro?')) return;
    
    const config = CONFIG[currentTab];
    try {
        const res = await fetch(`${config.api}/${id}`, { method: 'DELETE' });
        if(res.ok) {
            // ✅ CORREÇÃO: Usa o estado salvo em vez de forçar true
            carregarDados(ultimaBuscaFoiTodos); 
        } else {
            alert('Erro ao excluir.');
        }
    } catch (e) {
        console.error(e);
        alert('Erro de conexão.');
    }
}

// 4. Formulário
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
            // ✅ CORREÇÃO: Recarrega mantendo o contexto
            carregarDados(ultimaBuscaFoiTodos);
        } else {
            alert('Erro ao salvar.');
        }
    } catch (error) {
        console.error(error);
        alert('Erro de conexão.');
    }
});

// Auxiliares
function abrirModal() {
    document.getElementById('modalForm').classList.add('show');
    if(!document.getElementById('editId').value) {
         document.getElementById('dynamicForm').reset();
         renderEmptyForm();
    }
}

function renderEmptyForm() {
    const config = CONFIG[currentTab];
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    document.getElementById('editId').value = '';
    document.getElementById('modalTitle').textContent = 'Novo Registro';

    config.formFields.forEach(field => {
         let inputHtml = '';
         if(field.type === 'select') {
             const options = field.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
             inputHtml = `<select name="${field.name}">${options}</select>`;
         } else {
             inputHtml = `<input type="${field.type}" name="${field.name}">`;
         }
         container.innerHTML += `<div class="form-group"><label>${field.label}</label>${inputHtml}</div>`;
    });
}

function fecharModal() {
    document.getElementById('modalForm').classList.remove('show');
}