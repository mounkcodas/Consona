# Otimização de leituras do Consona

Implementada e publicada em 8 de novembro de 2026 (horário de Brasília).

## Causa e solução

Cada aba aberta consultava `/api/library` a cada 15 segundos. Cada chamada
repetia as listagens completas de faixas, associações, álbuns, playlists e
usuários, além de favoritos/histórico. A montagem do JSON procurava faixas e
álbuns repetidamente com `find`, aumentando também o custo de CPU.

O contrato da API e os fluxos da interface foram preservados:

- Uma consulta indexada lê as versões do catálogo e dos dados do usuário.
- `If-None-Match` recebe `304` quando nada mudou. A sessão é validada antes
  dessa decisão; logout e expiração continuam impedindo acesso.
- O catálogo serializado fica no Cache API da Cloudflare e em um único
  objeto R2 por origem. A versão é conferida antes do uso; não se depende de
  expiração ou de purge local para tornar edições visíveis em outras regiões.
- Favoritos/histórico ficam em entradas separadas, por usuário e versão.
  Nunca são gravados no snapshot compartilhado do R2.
- O JSON compartilhado é transmitido como stream e recebe um pequeno sufixo
  privado. Não é necessário analisar e serializar todas as músicas em cada GET.
- Triggers SQL atualizam as versões na mesma transação das alterações, inclusive
  exclusões em cascata. Falhas/rollback não publicam versões. Rascunhos de
  importação não invalidam o catálogo até serem confirmados.
- O navegador reaproveita o mesmo objeto em respostas 304, reúne GETs simultâneos,
  descarta respostas anteriores a uma alteração/troca de conta e suspende o
  polling com a aba oculta. Retomar a aba dispara a atualização imediatamente.

O R2 usa `cache/library-v1/<origem>/shared.json`, um prefixo JSON interno que
não contém o fechamento do objeto: o Worker acrescenta os dados privados e
o fechamento ao responder. Essa chave não é acessível pela rota `/api/media`.
Somente dados publicados e atribuição pública dos contribuidores entram nela.
As entradas de borda expiram em 24 horas; a validade depende da versão D1,
não desse prazo. Um snapshot R2 da mesma versão continua válido após expiração.

## Outras leituras reduzidas

- Confirmações de importação consultam apenas os álbuns de destino e suas faixas.
- Índices cobrem consultas de rascunhos, arquivos publicados, histórico e as
  relações inversas das chaves estrangeiras usadas em exclusões.
- Exclusões usam as cascatas já definidas no esquema em uma única operação.
- A limpeza do histórico usa o limite indexado das 200 reproduções recentes.
- A vitrine de capas tem cache de borda, sem repetir consultas em cada visita.
- Rotas públicas de mídia e saúde não consultam sessões desnecessariamente.

## Evidência de validação

`npm test`: 25 testes aprovados, incluindo execução do Worker em workerd via
Miniflare, D1, R2 e Cache API locais. Fixture: 750 faixas.

| Cenário medido | Linhas D1 lidas |
| --- | ---: |
| Primeira carga, sem cache | 2.264 |
| 100 verificações sem alterações | 400 no total |
| Cada verificação sem alterações | 4 |

A redução é de **99,82%** nesse teste, comparando as verificações com repetir
uma carga fria. As quatro linhas incluem autenticação e controle de versões.
Isso não significa que todas as operações custam quatro linhas: alterações,
importações, histórico e reconstruções têm custos próprios.

Também foram testados isolamento entre contas, logout, alterações imediatas,
exclusões em cascata, rollback, cache após eviction, rascunho oculto, commit
idempotente, descarte, requisições simultâneas e CORS com ETag.

Na produção, uma conta temporária verificou igualdade completa do JSON antes
e depois: **720 faixas, 33 álbuns e 1 playlist**. Cache R2/EDGE e dez respostas
304 consecutivas foram confirmados, assim como 401 sem autenticação e
preflight CORS. Os planos SQL confirmaram os índices das consultas de rascunho
e associações de álbum. Build, sintaxe e empacotamento Wrangler passaram.

No navegador de produção, foram confirmados login, polling 304, navegação
álbum → faixas, áudio com resposta 206 e reprodução ativa, abertura do
organizador, atualização imediata após salvar perfil e logout. As contas
temporárias foram removidas. Foi observado HTTP 403 na recomendação Last.fm;
essa integração não foi alterada nem considerada validada por este trabalho.

Versões publicadas: API `2cbe2161-c958-4352-8df1-e06a295bb248`, frontend
`55a76840-7e4d-458a-9309-2e842095f186`. Bundle verificado:
`app-cWvdKdtQ.js`. Backup anterior à migração (ignorado pelo Git):
`.wrangler/backups/before-read-optimization.sql`.

## Operação e implantação

1. Salvar backup do D1 e conferir esquema/bindings atuais.
2. Aplicar **somente** `api/migrations/0007_read_optimization.sql`. É aditiva e
   idempotente; não executar novamente as migrações históricas sem conferir
   seu rastreamento, pois contêm `ALTER TABLE` já aplicados.
3. Publicar a API mantendo `DB`, `MEDIA` e os segredos existentes.
4. Publicar `dist` após `npm run build` e validar o site.

Os clientes antigos continuam funcionando com o cache do servidor, mesmo sem
enviar ETag. O novo cliente também aceita uma API antiga sem ETag. A migração
pode permanecer ao reverter o Worker; ela não transforma nem remove músicas.

Para alterações futuras no formato serializado, incrementar `VERSION` em
`api/src/library-cache.js` para não reutilizar snapshots do formato anterior.
Novos campos/tabelas que afetem a biblioteca também precisam participar da
invalidação. Escritas diretas nas tabelas existentes já acionam os triggers.

O header `X-Library-Cache` informa `D1`, `R2`, `EDGE` ou `NOT-MODIFIED`.
O evento `library_catalog_rebuild` informa a versão e `rowsRead`; erros de cache
geram `library_cache_error`. Logs/traces mantêm amostragem de 10%.

Uma primeira carga sem nenhum cache ainda lê o catálogo completo. Misses
simultâneos em regiões diferentes podem reconstruir a mesma versão mais de uma
vez; não há lock global. A quantidade diária real deve ser conferida nas
métricas D1 após um ciclo normal de uso. Paginação visível não foi introduzida,
pois busca, fila e organização atualmente dependem da biblioteca completa.

Referências: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[transações D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[índices D1](https://developers.cloudflare.com/d1/best-practices/use-indexes/).
