# V23 REAL PERFORMANCE
Mantém o estado Redis atual e o limite de 20 entradas.
Adiciona PnL real realizado por delta de saldo SOL antes do BUY e depois do SELL, incluindo fees.
Mostra wins/losses reais. Não aumenta tamanho de posição nem número de trades antes de provar expectativa líquida positiva.
Hard stop paper/real signal: -9% quando aplicável; hold máximo: 60s quando essas constantes existem.
