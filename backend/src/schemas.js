import { z } from 'zod';
const name=z.string().trim().min(1).max(120);
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const money=z.number().int().min(0).max(100000000);
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const safeUrl=z.union([z.literal(''),z.string().url().refine(s=>s.startsWith('https://'),'Только HTTPS')]);
export const theme=z.object({
  background:color.default('#f7f5f0'),card:color.default('#ffffff'),text:color.default('#252b24'),muted:color.default('#6e7669'),
  primary:color.default('#d94c32'),onPrimary:color.default('#ffffff'),secondary:color.default('#324934'),price:color.default('#252b24'),
  radius:z.number().int().min(0).max(32).default(20),layout:z.enum(['grid','list']).default('grid'),
  logo:safeUrl.default(''),cover:safeUrl.default(''),headline:z.string().max(100).default('Вкус начинается здесь'),
  blocks:z.array(z.enum(['banner','categories','popular','new'])).max(4).default(['banner','categories','popular']),
}).strict();
export const brand=z.object({name,description:z.string().max(500).default(''),active:z.boolean().default(true),menuId:z.string().max(100).default(''),
  organizationId:z.string().max(100).default(''),priceCategoryId:z.string().max(100).default(''),
  bonusLimitType:z.enum(['percent','amount']).default('percent'),bonusLimit:z.number().int().min(0).max(1000000).default(30),
  initialConfirmation:z.enum(['confirmed','unconfirmed']).default('unconfirmed'),
}).strict().refine(b=>b.bonusLimitType!=='percent'||b.bonusLimit<=100,'Процент не может превышать 100');
export const branch=z.object({name,brandId:identifier,address:z.string().max(400).default(''),timezone:z.literal('Europe/Moscow').default('Europe/Moscow'),
  terminalGroupId:z.string().max(100).default(''),priceCategoryId:z.string().max(100).default(''),
  active:z.boolean().default(true),acceptingOrders:z.boolean().default(true),
  modes:z.object({delivery:z.boolean(),pickup:z.boolean(),scheduled:z.boolean(),dinein:z.boolean()}).default({delivery:true,pickup:true,scheduled:false,dinein:false}),
  minimum:money.default(70000),deliveryFee:money.default(19900),freeDelivery:money.default(150000),
  opening:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('10:00'),closing:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('23:00'),
  deliveryDescription:z.string().max(1000).default(''),
}).strict();
export const paymentMethod=z.object({name,brandId:identifier,type:z.enum(['cash','card','sbp','qr','manual']),enabled:z.boolean().default(true),
  iikoPaymentTypeId:z.string().max(100).default(''),instructions:z.string().max(500).default(''),
}).strict();
export const tariff=z.object({type:z.enum(['subscription','commission']),monthly:money.default(0),commissionBps:z.number().int().min(0).max(10000).default(0),
  implementation:money.default(2000000),effectiveFrom:z.string().date().refine(s=>s.endsWith('-01'),'Тариф вступает в силу с первого числа месяца'),includeDelivery:z.boolean().default(false),
}).strict();
export const promo=z.object({brandId:identifier,code:z.string().trim().min(1).max(50),name,active:z.boolean().default(true),
  iikoActionId:z.string().max(100).default(''),description:z.string().max(500).default(''),
}).strict();
export const orderInput=z.object({
  brandId:identifier,branchId:identifier,methodId:identifier,mode:z.enum(['delivery','pickup','dinein']),
  items:z.array(z.object({productId:identifier,quantity:z.number().int().min(1).max(30)}).strict()).min(1).max(50),
  requestedBonus:z.number().int().min(0).max(1000000).default(0),promoCode:z.string().max(50).default(''),
  scheduledAt:z.string().datetime({offset:true}).optional(),table:z.string().max(30).default(''),
  address:z.string().max(500).default(''),comment:z.string().max(500).default(''),
}).strict();
export const schemas={brand,branch,paymentMethod,tariff,promo};
export const revisionBody=schema=>z.object({revision:z.number().int().positive(),data:schema}).strict();
export function parse(schema,body){return schema.parse(body);}
export const textName=name;
export const resourceId=identifier;
