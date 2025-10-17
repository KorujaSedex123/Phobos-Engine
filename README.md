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

