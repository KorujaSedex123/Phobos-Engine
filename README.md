# Phobos Engine

![Logo](assets/logo.png)

## Sobre o Projeto

**Phobos Engine** é um bot de trading para criptomoedas, desenvolvido em Node.js com uma interface gráfica em Electron. O seu principal objetivo é automatizar uma estratégia de trading no mercado Spot da Binance, permitindo ao utilizador monitorizar as operações através de um dashboard completo e receber alertas em tempo real.

A estratégia principal baseia-se na combinação de dois indicadores técnicos:
1.  **Índice de Força Relativa (RSI):** Utilizado para identificar momentos de "sobrevenda" no mercado, sinalizando potenciais pontos de compra.
2.  **Média Móvel Simples (SMA):** Usada como um filtro de tendência para garantir que as compras só sejam efetuadas quando a tendência geral do mercado for de alta, tornando a estratégia mais segura.

---

## 🚀 Funcionalidades Principais

O Phobos Engine foi construído com um conjunto robusto de funcionalidades para trading automatizado e monitorização:

* **Interface Gráfica Completa:** Um dashboard desenvolvido com Electron que exibe em tempo real:
    * **Status do Mercado:** Preço atual, RSI e Média Móvel do ativo monitorizado.
    * **Portfólio & Performance:** Saldo da carteira, estado da posição aberta, preço de compra, lucro total e estatísticas da sessão (taxa de acerto, etc.).
    * **Gráfico de Preços:** Um gráfico que plota o histórico recente dos preços.
    * **Logs Detalhados:** Um registo de todas as decisões, cálculos, ordens e erros do bot.

* **Estratégia Personalizável:** O utilizador pode ajustar os parâmetros da estratégia diretamente na interface antes de iniciar:
    * **RSI de Compra:** Nível que ativa o gatilho de compra.
    * **Take Profit (%):** Meta de lucro para venda automática.
    * **Stop Loss (%):** Limite de perda para proteção do capital.
    * **Trailing Stop Loss (%):** Um stop loss dinâmico que sobe com o preço para maximizar os lucros.

* **Controlo Manual e de Sessão:**
    * **Liquidar Posição:** Um botão permite a venda manual imediata de qualquer posição aberta.
    * **Parar/Reiniciar Monitoramento:** O utilizador pode pausar o bot e voltar à tela inicial para selecionar um novo ativo ou ajustar a estratégia.

* **Funcionalidades Remotas (Discord):**
    * **Alertas em Tempo Real:** Envia notificações privadas (DMs) no Discord sobre cada compra, venda (com lucro ou prejuízo) e erros críticos.
    * **Comandos de Informação:** Responde a comandos como `!status`, `!info <ATIVO>` e `!rsi <ATIVO>` para obter informações do bot remotamente.

* **Segurança e Robustez:**
    * **Validação de Ordens:** O bot verifica dinamicamente as regras da Binance (`minNotional` e `minQty`) antes de cada operação para evitar erros.
    * **Venda ao Sair:** Liquida automaticamente qualquer posição aberta antes de fechar a aplicação para não deixar operações "órfãs".
    * **Histórico Persistente:** Salva um registo de todas as operações concluídas no ficheiro `trade_history.json`.

---

## ⚙️ Configuração

Para executar o Phobos Engine, siga os passos abaixo.

### Pré-requisitos
* [Node.js](https://nodejs.org/) (versão 16 ou superior)
* [Git](https://git-scm.com/)

### 1. Clonar o Repositório
```sh
git clone [https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git](https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git)
cd SEU_REPOSITORIO

2. Instalar as Dependências
Bash

npm install
3. Configurar as Chaves Secretas (.env)
Crie um ficheiro chamado .env na raiz do projeto e adicione as suas chaves:

Snippet de código

# Credenciais da Binance (para trading real)
API_KEY=SUA_CHAVE_DE_API_REAL_DA_BINANCE
API_SECRET=SUA_CHAVE_SECRETA_REAL_DA_BINANCE

# Credenciais do Discord (para notificações e comandos)
DISCORD_BOT_TOKEN=TOKEN_DO_SEU_BOT_DO_DISCORD
DISCORD_USER_ID=SEU_ID_DE_USUARIO_DO_DISCORD
Chaves da Binance: Devem ter permissão para "Habilitar Leitura" e "Ativar Trading Spot e de Margem".

4. Ajustar a Estratégia (config.json)
O ficheiro config.json contém as configurações padrão da estratégia. Pode ajustá-las aqui ou diretamente na interface do bot antes de iniciar.

▶️ Como Executar
Modo de Desenvolvimento
Para iniciar o aplicativo no modo de desenvolvimento:

Bash

npm start
Gerar o Executável
Para empacotar o bot num ficheiro .exe instalável (para Windows):

Bash

npm run dist
O instalador será gerado na pasta dist/. Após instalar, lembre-se de copiar os ficheiros .env e config.json para a pasta de instalação do programa.

⚠️ Aviso Legal
Este projeto é para fins educacionais. O trading de criptomoedas envolve um risco financeiro significativo. Não me responsabilizo por quaisquer perdas financeiras que possam ocorrer com o uso deste bot. Use por sua conta e risco e comece com valores que esteja disposto a perder.