import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const PRODUCT_REF_PREFIX = 'P-';
export const ITEM_NO_PREFIX = 'C-';

type CodeDb = PrismaService | Prisma.TransactionClient;

export function formatSequentialCode(prefix: string, seq: number) {
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function nextSequence(values: Array<string | null | undefined>, prefix: string) {
  const pattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`,
    'i',
  );
  let max = 0;
  for (const value of values) {
    const match = pattern.exec(String(value || '').trim());
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

export async function allocateProductReferences(
  db: CodeDb,
  companyId: string,
  count: number,
) {
  const rows = await db.product.findMany({
    where: { companyId, reference: { startsWith: PRODUCT_REF_PREFIX } },
    select: { reference: true },
  });
  let seq = nextSequence(
    rows.map((row) => row.reference),
    PRODUCT_REF_PREFIX,
  );
  return Array.from({ length: count }, () =>
    formatSequentialCode(PRODUCT_REF_PREFIX, seq++),
  );
}

export async function allocateItemNumbers(
  db: CodeDb,
  companyId: string,
  count: number,
) {
  const rows = await db.productVariant.findMany({
    where: { companyId, itemNo: { startsWith: ITEM_NO_PREFIX } },
    select: { itemNo: true },
  });
  let seq = nextSequence(
    rows.map((row) => row.itemNo),
    ITEM_NO_PREFIX,
  );
  return Array.from({ length: count }, () =>
    formatSequentialCode(ITEM_NO_PREFIX, seq++),
  );
}
