import { skipToken } from '@reduxjs/toolkit/query/react'
import { Currency, CurrencyAmount, TradeType } from '@uniswap/sdk-core'
import { IMetric, MetricLoggerUnit, setGlobalMetric } from '@uniswap/smart-order-router'
import { sendTiming } from 'components/analytics'
import { AVERAGE_L1_BLOCK_TIME } from 'constants/chainInfo'
import { useRoutingAPIArguments } from 'lib/hooks/routing/useRoutingAPIArguments'
import ms from 'ms'
import { useMemo } from 'react'

import { useGetQuoteQuery, useGetQuoteQueryState } from './slice'
import {
  ClassicTrade,
  InterfaceTrade,
  INTERNAL_ROUTER_PREFERENCE_PRICE,
  QuoteMethod,
  QuoteState,
  RouterPreference,
  TradeState,
} from './types'

const TRADE_NOT_FOUND = { state: TradeState.NO_ROUTE_FOUND, trade: undefined } as const
const TRADE_LOADING = { state: TradeState.LOADING, trade: undefined } as const

export function useRoutingAPITrade<TTradeType extends TradeType>(
  tradeType: TTradeType,
  amountSpecified: CurrencyAmount<Currency> | undefined,
  otherCurrency: Currency | undefined,
  routerPreference: typeof INTERNAL_ROUTER_PREFERENCE_PRICE,
  skipFetch?: boolean,
  account?: string
): {
  state: TradeState
  trade?: ClassicTrade
  swapQuoteLatency?: number
}

export function useRoutingAPITrade<TTradeType extends TradeType>(
  tradeType: TTradeType,
  amountSpecified: CurrencyAmount<Currency> | undefined,
  otherCurrency: Currency | undefined,
  routerPreference: RouterPreference,
  skipFetch?: boolean,
  account?: string
): {
  state: TradeState
  trade?: InterfaceTrade
  swapQuoteLatency?: number
}

/**
 * Returns the best trade by invoking the routing api or the smart order router on the client
 * @param tradeType whether the swap is an exact in/out
 * @param amountSpecified the exact amount to swap in/out
 * @param otherCurrency the desired output/payment currency
 */
export function useRoutingAPITrade<TTradeType extends TradeType>(
  tradeType: TTradeType,
  amountSpecified: CurrencyAmount<Currency> | undefined,
  otherCurrency: Currency | undefined,
  routerPreference: RouterPreference | typeof INTERNAL_ROUTER_PREFERENCE_PRICE,
  skipFetch = false,
  account?: string
): {
  state: TradeState
  trade?: InterfaceTrade
  method?: QuoteMethod
  swapQuoteLatency?: number
} {
  const [currencyIn, currencyOut]: [Currency | undefined, Currency | undefined] = useMemo(
    () =>
      tradeType === TradeType.EXACT_INPUT
        ? [amountSpecified?.currency, otherCurrency]
        : [otherCurrency, amountSpecified?.currency],
    [amountSpecified, otherCurrency, tradeType]
  )

  const queryArgs = useRoutingAPIArguments({
    account,
    tokenIn: currencyIn,
    tokenOut: currencyOut,
    amount: amountSpecified,
    tradeType,
    routerPreference,
  })

  const { isError, data: tradeResult, error, currentData } = useGetQuoteQueryState(queryArgs)
  useGetQuoteQuery(skipFetch ? skipToken : queryArgs, {
    // Price-fetching is informational and costly, so it's done less frequently.
    pollingInterval: routerPreference === INTERNAL_ROUTER_PREFERENCE_PRICE ? ms(`1m`) : AVERAGE_L1_BLOCK_TIME,
    // If latest quote from cache was fetched > 2m ago, instantly repoll for another instead of waiting for next poll period.
    refetchOnMountOrArgChange: 2 * 60,
  })
  const isFetching = currentData !== tradeResult || !currentData
  // Only "progressive" trades - those with the same currencies as the last trade - should show the last trade while loading.
  const isProgressive =
    tradeResult?.trade &&
    currencyIn?.equals(tradeResult.trade.inputAmount.currency) &&
    currencyOut?.equals(tradeResult.trade.outputAmount.currency)

  return useMemo(() => {
    if (queryArgs === skipToken || isError) {
      return {
        state: TradeState.INVALID,
        trade: undefined,
        error: JSON.stringify(error),
      }
    } else if (tradeResult?.state === QuoteState.NOT_FOUND && !isFetching) {
      return TRADE_NOT_FOUND
    } else if (!tradeResult?.trade) {
      return TRADE_LOADING
    } else {
      return {
        state: isFetching ? TradeState.LOADING : TradeState.VALID,
        trade: isProgressive ? tradeResult?.trade : undefined,
        swapQuoteLatency: tradeResult?.latencyMs,
      }
    }
  }, [
    error,
    isError,
    isFetching,
    isProgressive,
    queryArgs,
    tradeResult?.latencyMs,
    tradeResult?.state,
    tradeResult?.trade,
  ])
}

// only want to enable this when app hook called
class GAMetric extends IMetric {
  putDimensions() {
    return
  }

  putMetric(key: string, value: number, unit?: MetricLoggerUnit) {
    sendTiming('Routing API', `${key} | ${unit}`, value, 'client')
  }

  setProperty() {
    return
  }
}

setGlobalMetric(new GAMetric())
