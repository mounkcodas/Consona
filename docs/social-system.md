# Consona — Amigos, chat e atividade musical

Implementação de 8 de novembro de 2026, integrada ao player existente e publicada em `https://consona.live`.

A marcação abaixo indica funcionalidade implementada. A seção de validação distingue os testes executados das condições que dependem do navegador ou da rede; não representa uma auditoria de segurança completa.

## Checklist de implementação — 70/70

### Amigos e contatos — 9/9

- [x] Pesquisar usuários por nome ou @username (prefixo, mínimo de 2 caracteres).
- [x] Enviar, aceitar, recusar e cancelar solicitações de amizade.
- [x] Listar amigos online, ausentes e offline; também disponível o estado ocupado.
- [x] Mostrar avatar, nome, status e última atividade autorizada.
- [x] Pesquisar e ordenar amigos por nome, presença e atividade.
- [x] Remover amigos, bloquear e desbloquear usuários.
- [x] Abrir o perfil de um amigo.
- [x] Exibir contagem de amigos e solicitações pendentes.
- [x] Notificar solicitações e amizades aceitas.

### Conversas e mensagens — 16/16

- [x] Abrir uma conversa individual com um amigo, sem duplicar a conversa.
- [x] Enviar e receber mensagens em tempo real.
- [x] Persistir mensagens e carregar histórico em páginas de 40 mensagens.
- [x] Exibir horário, ordem e estados enviada, entregue e lida.
- [x] Exibir indicador de digitação com expiração.
- [x] Exibir mensagens não lidas.
- [x] Enviar emojis e renderizar links HTTP/HTTPS seguros, sem HTML arbitrário.
- [x] Compartilhar músicas, álbuns e playlists como cartões.
- [x] Reproduzir itens compartilhados no player existente.
- [x] Pesquisar conversas por contato/prévia e mensagens por índice FTS5.
- [x] Editar e excluir mensagens próprias; exclusão propagada aos participantes.
- [x] Enviar imagens e arquivos com limite de 8 MB e verificação de formato.
- [x] Notificar novas mensagens e abrir o acesso flutuante.
- [x] Preservar rascunhos e posição de leitura por conversa/conta.
- [x] Silenciar e arquivar conversas.
- [x] Limitar envios, digitação, uploads, solicitações, buscas, convites e denúncias.

### Chat flutuante e tela cheia — 12/12

- [x] Abrir o Messenger em qualquer página autenticada.
- [x] Minimizar, restaurar e fechar sem perder a conversa.
- [x] Alternar entre Amigos e Conversas.
- [x] Pesquisar contatos e iniciar conversa pelo mini Messenger.
- [x] Expandir para a central e retornar à página anterior com o modo flutuante.
- [x] Preservar conversa, rolagem e texto durante a alternância.
- [x] Manter o mesmo elemento de áudio e a reprodução funcionando.
- [x] Arrastar/redimensionar janelas no desktop e ajustar à área disponível.
- [x] Reservar espaço para o player fixo.
- [x] Mostrar contagem de mensagens quando minimizado.
- [x] Persistir modo, posição e tamanho por conta.
- [x] Oferecer painel próprio para celular, com retorno à lista e ao player.

### Atividade musical — 12/12

- [x] Mostrar a música compartilhada por cada amigo.
- [x] Mostrar capa, artista, título e álbum.
- [x] Atualizar ao trocar de faixa.
- [x] Diferenciar reprodução, pausa e ausência de atividade.
- [x] Mostrar atividade na lista de amigos.
- [x] Mostrar detalhes do amigo selecionado.
- [x] Abrir música ou álbum no Consona.
- [x] Oferecer “Ouvir junto”, separado de “Ouvir”.
- [x] Sincronizar faixa, posição e pausa após aceitação explícita do convite.
- [x] Compartilhar a música atual diretamente no chat.
- [x] Compartilhar histórico recente (até 20 faixas) apenas com autorização.
- [x] Ocultar atividade e usar modo invisível.

### Perfil e ações sociais — 8/8

- [x] Mostrar perfil, avatar e @username.
- [x] Mostrar data de entrada e quantidade de playlists públicas.
- [x] Listar playlists públicas do amigo (as playlists da biblioteca compartilhada existente).
- [x] Abrir perfil pelo painel lateral.
- [x] Oferecer atalhos para conversar e ouvir junto.
- [x] Remover amizade e bloquear pelo painel do amigo.
- [x] Respeitar privacidade na presença e na música atual.
- [x] Registrar denúncias de usuário ou mensagem, incluindo evidência da mensagem.

### Notificações, privacidade e confiabilidade — 13/13

- [x] Notificações internas de mensagens, solicitações e convites.
- [x] Notificações do navegador com solicitação explícita de permissão.
- [x] Preferências sociais individuais.
- [x] Definir quem pode enviar mensagens e solicitações.
- [x] Controlar visibilidade da presença e atividade.
- [x] Restringir chamadas e convites para ouvir junto.
- [x] Autenticar WebSockets com tickets de uso único e expiração curta.
- [x] Autorizar acesso às conversas, mensagens e anexos no servidor.
- [x] Reconectar com espera progressiva e recuperar estado/histórico recente.
- [x] Distribuir mensagens, recibos, presença e preferências entre abas/dispositivos.
- [x] Evitar duplicação por `conversation_id + sender_id + client_id`.
- [x] Revogar acesso após bloqueio/remoção e encerrar sessões compartilhadas.
- [x] Oferecer rótulos acessíveis, foco visível, diálogos nativos, navegação por teclado e anúncio de mensagens.

## Onde está implementado

| Camada | Arquivos | Responsabilidade |
|---|---|---|
| Integração do player | `src/main.jsx` | Navegação, player persistente, cartões e reprodução sincronizada |
| Estado social | `src/social/useSocial.js` | Socket, reconexão, mensagens, recibos, privacidade e sincronização |
| Central e janelas | `src/social/SocialSystem.jsx`, `social.css` | Amigos, solicitações, perfis, atividade, ajustes e layout responsivo |
| Conversas | `src/social/ChatPane.jsx` | Histórico, busca, rascunhos, anexos, cartões e edição |
| Chamadas | `src/social/CallPanel.jsx` | Convite, aceitação, sinalização WebRTC, microfone/câmera e encerramento |
| Isolamento de falhas | `src/social/SocialBoundary.jsx` | Um erro de renderização social não desmonta o player |
| API | `api/src/social-api.js`, `social-core.js` | Autenticação, autorização, validação, persistência e limites |
| Tempo real | `api/src/social-realtime.js` | Um `SocialUser` por usuário e um `ListeningSession` por sessão |
| Dados | `api/migrations/0008_social.sql`, `0009_social_search_scope.sql` | Tabelas, índices e busca FTS5 restrita por conversa, sem alterar os dados musicais |
| Testes | `api/test/social.test.js`, `social-harness.js` | Runtime real local de Worker, D1, R2 e Durable Objects |

## Custo e privacidade

- D1 armazena amizades, mensagens, cursores de leitura, preferências, notificações, denúncias e o registro inicial/final das sessões. Paginação usa índice e cursor `seq`; não usa `OFFSET` nem carrega todo o histórico.
- Presença, digitação, posição da música, histórico transitório e coordenação ficam nos Durable Objects com SQLite. Há expiração da presença após 95 segundos sem atualização; ping/pong usa a API de hibernação. A atualização normal ocorre a cada 30 segundos ou quando faixa/pausa/posição muda, nunca a cada `timeupdate` do player.
- A primeira resolução de uma faixa pode ler o D1; atualizações seguintes da mesma faixa reutilizam o valor no Durable Object. O teste mediu cinco atualizações de posição com **0 linhas lidas e 0 escritas no D1**.
- Operações sociais não alteram a revisão do catálogo musical nem invalidam o cache do cliente da biblioteca. Os testes existentes continuam medindo **4 linhas por revalidação**, frente a 2.264 linhas no carregamento completo da biblioteca de teste: redução de **99,82%** nesse cenário.
- Atividade musical e histórico começam desativados. A presença pode ser ocultada; invisibilidade também oculta atividade/histórico. Chamadas recebidas começam desativadas.
- Anexos ficam sob `social/` no R2, fora da rota pública de mídia. O download exige autenticação e amizade ativa; imagens são carregadas por URL de blob no navegador, sem token na URL.
- Tickets WebSocket duram 60 segundos, são consumidos uma vez e respeitam o vencimento/revogação da sessão. Query strings são removidas dos logs do Worker.
- Cleanup horário (`17 * * * *`) remove anexos não enviados após 24 horas e notificações lidas após 30 dias. Mensagens não são removidas pelo cleanup.

## Validação executada

- `npm test`: 34 testes aprovados, incluindo regressões da biblioteca/importações e oito cenários sociais integrados.
- `npm run check:api`, build de produção e dry run do Wrangler aprovados.
- Local: amizade entre duas contas, mensagens, atividade, aceitação de “ouvir junto”, pausa sincronizada, preservação do rascunho na alternância, player contínuo e layout de 390 × 844.
- Produção: autenticação real de duas contas temporárias, WebSocket autenticado, idempotência, mensagens nos dois sentidos, cartão de música da biblioteca real, atividade após opt-in e sessão de “ouvir junto” com aceitação.
- Produção: download de anexo pelo destinatário, rejeição de download anônimo, rejeição pela rota pública de mídia, exclusão do arquivo e busca de mensagens após a migração do índice por conversa.
- Produção: bloquear um participante removeu o chat da outra conta e encerrou a sessão de escuta. As duas contas temporárias e suas mensagens foram removidas; a verificação final encontrou 0 contas de teste, 0 mensagens de teste e os 3 usuários originais.
- Produção: chamada WebRTC estabelecida com trilhas de áudio e vídeo **sintéticas** em duas sessões isoladas do navegador; nenhum microfone/câmera pessoal foi usado no teste.
- Produção: chat móvel terminou em y=736 e player começou em y=740, sem sobreposição no viewport de 390 × 844. Capturas locais em `.wrangler/social-desktop-production.png` e `.wrangler/social-mobile-production.png`.
- Biblioteca publicada observada: 720 faixas e 33 álbuns. Nenhuma faixa/álbum de teste foi adicionada à produção.

## Limites operacionais e manutenção

- Chamadas são um complemento aos 70 itens. Usam WebRTC direto e STUN. Para redes que exigem relay, configurar o segredo opcional `SOCIAL_TURN_SERVERS` com um array JSON de servidores ICE (`urls`, `username`, `credential`), usando credenciais temporárias/rotacionadas. Não há TURN contratado/configurado nesta entrega. O teste em um mesmo ambiente não comprova conectividade entre todas as redes.
- Notificações dependem da permissão e do suporte do navegador. O fluxo de configuração está implementado; a entrega de notificações pelo sistema operacional não foi certificada em todos os navegadores.
- Convites de escuta expiram em 5 minutos; sessões ativas encerram após até 4 horas. O anfitrião controla por padrão e pode autorizar o convidado. O áudio é reproduzido separadamente nos navegadores; a correção de posição tolera aproximadamente 1,5 segundo para evitar saltos constantes.
- A lista inicial retorna até 200 conversas, 100 solicitações de cada direção, 50 notificações e 100 playlists no perfil. Mensagens e resultados da busca têm paginação própria. Esses limites devem ser reavaliados se a comunidade crescer significativamente.
- Denúncias são persistidas em `social_reports` para análise. Esta entrega não inclui uma equipe de moderação nem um painel administrativo de atendimento de denúncias.
- A busca Last.fm por recomendações já respondia HTTP 403 antes desta implementação e continuou assim durante o teste; não é usada pelo sistema social.
- Backup anterior à migração: `.wrangler/backups/before-social.sql`, ignorado pelo Git por conter dados privados. Nunca publicar esse arquivo.
- Ao atualizar a API, preservar `DB`, `MEDIA`, `SOCIAL`, `LISTENING` e os segredos existentes. A primeira publicação usa a migração de Durable Objects `social-v1`; atualizações seguintes preservam os namespaces existentes.
- Publicação final: API `e1164ac8ea7148d49be9b51af76a18a2`, frontend `83d477d52fec488bb6c5f21e378f62ea`, bundle servido e verificado `app-CEucmXT1.js`.
- Para reverter a interface, publicar o bundle anterior. Manter as tabelas e namespaces sociais para preservar mensagens; reversão de código não reverte migrações ou dados.

Referências técnicas: [WebSockets com hibernação](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [exportação/backup D1](https://developers.cloudflare.com/workflows/examples/backup-d1/), [otimização da biblioteca](./d1-read-optimization.md).
