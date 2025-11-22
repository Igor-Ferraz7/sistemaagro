// Estado da Aplicação
let currentTab = 'pessoas';

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
            <td>${item.status}</td>
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
            <td>${item.status}</td>
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
            // Formatação segura de valores e datas
            const valor = parseFloat(item.valortotal).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            const dataVenc = new Date(item.parcelas[0]?.datavencimento || item.datemissao).toLocaleDateString('pt-BR');
            const fornecedor = item.fornecedorCliente?.razaosocial || 'N/A';
            
            return `
                <td>${item.idMovimentoContas}</td>
                <td>${item.numeronotafiscal || 'S/N'}</td>
                <td>${fornecedor}</td>
                <td>${dataVenc}</td>
                <td><strong>${valor}</strong></td>
                <td>${item.status}</td>
                <td class="actions">
                    <button class="btn btn-del" onclick="excluir(${item.idMovimentoContas})">🗑️</button>
                </td>
            `;
        },
        formFields: [] // Deixar vazio por enquanto. Criação via PDF é o foco principal.
    }
};

// 1. Inicialização
document.addEventListener('DOMContentLoaded', () => {
    setupFilters();
});

function switchTab(tab) {
    currentTab = tab;
    
    // Atualiza visual das abas
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    // Limpa tabela (Regra A)
    document.getElementById('tableBody').innerHTML = '';
    
    // Configura Headers
    const headersRow = document.getElementById('tableHeaders');
    headersRow.innerHTML = CONFIG[tab].headers.map(h => `<th onclick="ordenar('${h}')">${h}</th>`).join('');
    
    setupFilters();
}

function setupFilters() {
    const select = document.getElementById('typeFilter');
    select.innerHTML = '<option value="">Todos os Tipos</option>';
    
    if(currentTab === 'pessoas') {
        ['FORNECEDOR', 'CLIENTE', 'FATURADO'].forEach(opt => {
            select.innerHTML += `<option value="${opt}">${opt}</option>`;
        });
    } else if (currentTab === 'classificacao') {
        ['RECEITA', 'DESPESA'].forEach(opt => {
            select.innerHTML += `<option value="${opt}">${opt}</option>`;
        });
    }
}

// 2. Carregar Dados (Regra B e C)
async function carregarDados(todos = false) {
    const termo = document.getElementById('searchInput').value;
    const tipo = document.getElementById('typeFilter').value;
    const config = CONFIG[currentTab];
    
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '<tr><td colspan="100%">Carregando...</td></tr>';

    try {
        // Monta URL com Query Params
        let url = `${config.api}?t=${Date.now()}`;
        if(todos) url += '&todos=true';
        if(termo) url += `&termo=${encodeURIComponent(termo)}`;
        if(tipo) url += `&tipo=${tipo}`;

        const res = await fetch(url);
        const data = await res.json();

        tbody.innerHTML = '';
        if(data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%">Nenhum registro encontrado.</td></tr>';
            return;
        }

        data.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = config.renderRow(item);
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="100%" style="color:red">Erro ao carregar dados.</td></tr>';
    }
}

// 3. Ações (Editar e Excluir)
function editar(item) {
    // Preenche o modal
    const config = CONFIG[currentTab];
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    
    // Determina ID correto (Pessoas ou Classificacao)
    const id = item.idPessoas || item.idClassificacao;
    document.getElementById('editId').value = id;
    document.getElementById('modalTitle').textContent = `Editar ${currentTab} #${id}`;

    // Gera campos dinamicamente
    config.formFields.forEach(field => {
        let inputHtml = '';
        const value = item[field.name] || '';
        
        if(field.type === 'select') {
            const options = field.options.map(opt => 
                `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`
            ).join('');
            inputHtml = `<select name="${field.name}">${options}</select>`;
        } else {
            inputHtml = `<input type="${field.type}" name="${field.name}" value="${value}">`;
        }
        
        container.innerHTML += `
            <div class="form-group">
                <label>${field.label}</label>
                ${inputHtml}
            </div>
        `;
    });

    abrirModal();
}

async function excluir(id) {
    if(!confirm('Deseja realmente inativar este registro?')) return;
    
    const config = CONFIG[currentTab];
    try {
        const res = await fetch(`${config.api}/${id}`, { method: 'DELETE' }); // Regra I
        if(res.ok) {
            alert('Registro inativado com sucesso!');
            carregarDados(true); // Recarrega lista
        } else {
            alert('Erro ao excluir.');
        }
    } catch (e) {
        console.error(e);
    }
}

// 4. Formulário (Salvar/Criar)
document.getElementById('dynamicForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = CONFIG[currentTab];
    const id = document.getElementById('editId').value;
    
    // Coleta dados do form
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    // Regra G e H (Status manipulado no backend ou oculto)
    
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
            carregarDados(true);
        } else {
            alert('Erro ao salvar.');
        }
    } catch (error) {
        console.error(error);
    }
});

// Auxiliares de Modal
function abrirModal() {
    document.getElementById('modalForm').classList.add('show');
    if(!document.getElementById('editId').value) {
         // Se for novo, gera campos vazios
         // (Lógica simplificada: clique em "Novo" deve limpar form antes)
         document.getElementById('dynamicForm').reset();
         // Recriar campos vazios (Necessário chamar a lógica de render fields vazia aqui)
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