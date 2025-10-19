FROM postgres:latest

# Você pode adicionar customizações aqui se quiser
# Por exemplo, copiar scripts de inicialização:
# COPY init.sql /docker-entrypoint-initdb.d/

# Ou instalar extensões:
# RUN apt-get update && apt-get install -y postgresql-contrib