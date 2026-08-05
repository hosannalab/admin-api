import { StockMovementReason, StockMovementType } from '@prisma/client';

export const REASONS_BY_TYPE: Record<
  StockMovementType,
  StockMovementReason[]
> = {
  IN: [
    StockMovementReason.PURCHASE,
    StockMovementReason.CUSTOMER_RETURN,
    StockMovementReason.POSITIVE_ADJUSTMENT,
  ],
  OUT: [
    StockMovementReason.SALE,
    StockMovementReason.SUPPLIER_RETURN,
    StockMovementReason.DAMAGE,
    StockMovementReason.NEGATIVE_ADJUSTMENT,
  ],
};

export const REASON_LABELS: Record<StockMovementReason, string> = {
  [StockMovementReason.INITIAL]: 'Inventario inicial',
  [StockMovementReason.PURCHASE]: 'Compra',
  [StockMovementReason.CUSTOMER_RETURN]: 'Devolución de cliente',
  [StockMovementReason.POSITIVE_ADJUSTMENT]: 'Ajuste positivo',
  [StockMovementReason.SALE]: 'Venta',
  [StockMovementReason.SUPPLIER_RETURN]: 'Devolución a proveedor',
  [StockMovementReason.DAMAGE]: 'Merma o daño',
  [StockMovementReason.NEGATIVE_ADJUSTMENT]: 'Ajuste negativo',
};

export function getReasonOptions(type?: StockMovementType) {
  const reasons = type
    ? REASONS_BY_TYPE[type]
    : Object.values(StockMovementReason).filter(
        (reason) => reason !== StockMovementReason.INITIAL,
      );

  return reasons.map((reason) => ({
    value: reason,
    label: REASON_LABELS[reason],
    type: Object.entries(REASONS_BY_TYPE).find(([, values]) =>
      values.includes(reason),
    )?.[0] as StockMovementType | undefined,
  }));
}

export function isReasonAllowedForType(
  type: StockMovementType,
  reason: StockMovementReason,
) {
  if (reason === StockMovementReason.INITIAL) {
    return false;
  }
  return REASONS_BY_TYPE[type].includes(reason);
}
