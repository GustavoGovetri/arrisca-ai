# Arrisca Aí

Jogo de perguntas e respostas para jogar com a família ou os amigos, no navegador.

**Jogar:** https://arrisca-ai.vercel.app/

## Como jogar

São dois jeitos:

- **Todo mundo no mesmo aparelho**: o celular passa de mão em mão, como no jogo de tabuleiro.
- **Sala online**: uma pessoa cria a sala e manda o link (ou o código de 4 letras) para os outros. Cada um entra pelo próprio celular, escolhe nome e cor, e quem criou a sala começa a partida.

Na sala online:

- quem está na vez aposta a ficha, escolhe o tema e usa as ajudas;
- o próximo jogador da roda é quem lê a pergunta: só ele vê a resposta, marca se acertou ou errou e controla o timer;
- na casa final, os outros jogadores escolhem o tema;
- quem criou a sala pode mudar a ordem, tirar alguém e ligar o "Controle total" para jogar por quem caiu da conexão.

Se alguém fechar o navegador, é só abrir o link de novo que volta para a mesma partida.

## Reportar perguntas

Qualquer jogador pode reportar uma pergunta (resposta errada, nível errado, pergunta confusa etc.). Os reportes vão para o banco do Firebase, em `/reportes`, e podem ser vistos em:

https://arrisca-ai-default-rtdb.firebaseio.com/reportes.json

Se o aparelho estiver sem internet, o reporte fica guardado e é enviado depois.

Quando uma pergunta for corrigida, coloque a chave dela em `resolvidos.json` (formato `tema|id|quando`, igual aparece no reporte). Assim ela some da lista de reportes de quem tinha mandado.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | o jogo inteiro |
| `questions.json` | o banco de perguntas |
| `net-firebase.js` | conexão com o Firebase (salas e reportes) |
| `config.js` | configuração pública do projeto no Firebase |
| `resolvidos.json` | reportes que já foram resolvidos |

Para testar o modo online sem Firebase, abra o site com `?net=local` em duas abas do mesmo navegador.
