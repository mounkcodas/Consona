muscao

## Busca de capas

A busca de capas usa MusicBrainz e Cover Art Archive, primeiro pela edi??o e depois pelo grupo do lan?amento. Os resultados Google s?o opcionais e aparecem junto da busca do Wikimedia Commons.

Para habilitar Google Images no Worker da API, configure as credenciais como secrets (nunca no frontend):

```powershell
npx wrangler secret put GOOGLE_CSE_API_KEY --config api/wrangler.jsonc
npx wrangler secret put GOOGLE_CSE_CX --config api/wrangler.jsonc
```

`GOOGLE_CSE_CX` ? o ID do mecanismo Programmable Search com pesquisa de imagens habilitada. Depois de configurar os secrets, publique o Worker da API. Sem credenciais, o bot?o Google informa que a integra??o n?o est? configurada e Wikimedia/CAA seguem dispon?veis.

**Disponibilidade do Google:** a documenta??o do Custom Search JSON API informa que a API est? fechada para novos clientes e ser? descontinuada em 1? de janeiro de 2027. Portanto, esta integra??o preparada depende de j? existir acesso habilitado ? API; n?o ? uma depend?ncia segura para uma configura??o nova.
