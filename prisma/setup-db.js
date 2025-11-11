// prisma/setup-db.js
const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

async function setupDatabase() {
  console.log('🔄 Verificando e configurando o banco de dados...');

  // 🔍 DEBUG: Veja qual URL está sendo usada
  console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL);

  try {
    console.log('📊 Executando prisma db push para criar as tabelas...');

    execSync('npx prisma db push --accept-data-loss', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL
      }
    });

    // Verificar se as tabelas foram criadas corretamente
    const prisma = new PrismaClient();
    await prisma.$connect();

    // Tentar acessar a tabela pessoas para verificar se foi criada
    try {
      await prisma.pessoas.count();
      console.log('✅ Tabela "pessoas" verificada com sucesso!');
    } catch (error) {
      if (error.code === 'P2021') {
        throw new Error('A tabela "pessoas" não foi criada corretamente. Verifique o schema do Prisma.');
      }
      throw error;
    }

    await prisma.$disconnect();
    console.log('✅ Banco de dados configurado com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao configurar o banco de dados:', error);
    return false;
  }
}

// Se o arquivo for executado diretamente
if (require.main === module) {
  setupDatabase()
      .then(success => {
        if (!success) {
          process.exit(1);
        }
      })
      .catch(error => {
        console.error('Erro fatal:', error);
        process.exit(1);
      });
}

module.exports = { setupDatabase };