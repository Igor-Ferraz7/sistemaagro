// geminiConfig.js

// Centraliza os nomes dos modelos para facilitar a manutenção
const GEMINI_CONFIG = {
    // Mudei para a versão específica "002" que é garantida de existir
    TEXT_MODEL: "gemini-2.5-flash", 
    
    // O modelo de embedding funcionou no seu log, então mantemos
    EMBEDDING_MODEL: "text-embedding-004"
};

module.exports = GEMINI_CONFIG;