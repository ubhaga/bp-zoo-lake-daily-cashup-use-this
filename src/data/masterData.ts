export const SUPPLIERS = [
  'Albany', 'Aquamil', 'Areana', 'Azura bakehouse', 'B&S Construction',
  'Bheki(Street Vendor)', 'BHT UMESH', 'Bizpro', 'Blake towing', 'Bmg(Forecourt rolls)',
  'BP Smit', 'Breiburg(Danny)', 'Builders', 'C&D Firewood', 'Citilec', 'Clover',
  'Dawn consultants', 'Deep frozen', 'Devine and Crystal', 'Dr cleen', 'Dustbin',
  'Espresso', 'Gingerman', 'Hazard', 'Hazstop', 'Hltc', 'Horizon Technologies',
  'Hydro depot', 'Ice 2000', 'ITP Fire services', 'Kalesh', 'KS Auto Spares',
  'Leeto', 'Lotto', 'Mica Hardware', 'Millenium', 'Mohago safety shoes', 'Niche Nosh',
  'Ola', 'Phillip Morris', 'Powersave', 'Pro Pest Control', 'Prowalco', 'RAW',
  'Redchem', 'Riverton', 'Rose Foundation', 'Saraband', 'Slam paper', 'Snack A juice',
  'Solly Biscuits', 'Spar', 'Sparkle chemicals', 'Spar Tops', 'Status Hygiene',
  'Sunbake', 'Sundry Supplier', 'The Raw Berry Press', 'Tlabo trading',
  'Tobacco Junction', 'UB', 'Vaishali', 'Veloutee', 'Vendor perfume',
  'Vetinary Hospital', 'Waste transporter', 'West pack', 'Wynns', 'Yank Snacks',
].sort();

export const PAYOUT_VENDORS = [
  'Benito Distributor', 'Albany', ...SUPPLIERS.filter(s => s !== 'Albany'),
].filter((v, i, a) => a.indexOf(v) === i).sort();

export const ACCOUNTS = [
  'Shop Expense', 'Mahindra', 'Lancaster Pharmacy', 'Hyde Park Toyota', 'Hltc',
  'St Theresas', 'Sayinile', 'Red cross', 'Umesh', 'Isuzu bakkie', 'Bp Zoolake',
  'Bp Zoolake Account Customer', 'Shell Parkhurst', 'Generator', 'House tech', 'Moses bpzl',
];

export const CATEGORIES = [
  'Advertising & Promotions', 'Cleaning materials', 'Computer Exp', 'Consulting Exp',
  'Consumables', 'COS C Store', 'Entertainment', 'Fines', 'Forecourt general Exp',
  'Licenses', 'Motor Veicle Expense', 'Occupational costs(W&E)', 'Office Exp',
  'Pest Control', 'R & M Buildings', 'R &M Motor Vehicles', 'Staff Refreshments',
  'Staff training', 'Staff-Medical', 'Stationery and Postage', 'Sundry Exp',
  'Telephone and Internet Fees', 'Training', 'Travel and Accomodation', 'UB', 'Uniforms',
  'Wages-Casual',
];

export const CASHIER_NAMES = ['Qondie', 'Jerry', 'Mishak', 'Sipho', 'Thabo', 'Zanele'];
export const MANAGER_NAMES = ['JN', 'Jerry', 'Manager'];

export const SPEEDPOINT_TERMINALS = [
  { name: 'Term 247608', shift: 'both' as const },
  { name: 'Forecourt 929661', shift: 'shop' as const },
  { name: 'Forecourt 929661', shift: 'opt' as const },
  { name: 'Retail 200660', shift: 'shop' as const },
  { name: 'V Plus', shift: 'opt' as const },
  { name: 'Scan to pay', shift: 'both' as const },
];

export const RECEIPT_TYPES = [
  'Blue Label',
  'Easypay',
  'Lotto Receipts',
  'Debtors Received on Account ROA',
  'Other',
];
