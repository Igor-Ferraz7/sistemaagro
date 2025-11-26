# 🌾 Sistema Financeiro Inteligente com IA

Um sistema robusto para **extração automática de dados de Notas Fiscais (PDF)**, gestão financeira (Contas a Pagar) e inteligência de dados usando **RAG (Retrieval-Augmented Generation)** e Vetores (Embeddings).

O sistema utiliza o **Google Gemini** para ler PDFs e interpretar perguntas em linguagem natural, e o **PostgreSQL (pgvector)** para armazenar dados e realizar buscas semânticas.

---

## 📖 Manual de Utilização

### 1. Configuração Inicial
Ao abrir o sistema pela primeira vez, uma janela solicitará sua **Chave de API do Gemini**.
- Cole sua chave (começa com `AIza...`).
- Clique em **Salvar**.

### 2. Processando uma Nota Fiscal
1.  Na tela inicial, arraste um PDF para a área pontilhada ou clique para selecionar.
2.  Clique em **"PROCESSAR COM I.A."**.
3.  Aguarde o processamento. O sistema irá:
    - Ler o PDF.
    - Verificar se o Fornecedor já existe (se não, cria).
    - Lançar a conta a pagar.
    - Gerar os vetores para busca futura.
4.  O resultado e o JSON extraído aparecerão na tela.

### 3. Gerenciando Dados (CRUD)
Clique no botão roxo **"Gestão de Cadastros"** (ou no menu lateral "Painel Administrativo").
- **Abas:** Alterne entre Pessoas, Classificação e Contas.
- **Buscar:** Use o campo de texto para filtrar por nome ou documento.
- **Listar Ativos:** Recarrega a lista padrão.
- **Novo Registro:** Abre formulário para inserção manual.
- **Editar (✏️):** Altera dados.
- **Excluir (🗑️):** Realiza a exclusão lógica (muda status para INATIVO), mantendo o histórico.

### 4. Fazendo Perguntas (RAG)
No menu lateral direito:
- **Consulta Estruturada:** Ideal para somas e valores exatos.
    - *Ex:* "Qual o valor total de notas do fornecedor X?"
- **Consulta Semântica:** Ideal para entender o conteúdo.
    - *Ex:* "O que foi comprado na nota fiscal de valor R$ 5.000?"

---

## ❓ Solução de Problemas Comuns

**Erro: `API key not valid`**
- **Causa:** A chave salva está incorreta ou expirada.
- **Solução:** Clique no botão de engrenagem "⚙️ Alterar Chave" no topo do site e insira uma chave válida.

---
