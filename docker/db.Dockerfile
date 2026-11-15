# Same Postgres image the data volume was created with, plus pgvector from the PGDG repository it already ships.
# Keeping the base avoids a glibc/collation change under existing text indexes.
FROM postgres:18@sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-18-pgvector=0.8.7-1.pgdg13+2 \
 && rm -rf /var/lib/apt/lists/*
