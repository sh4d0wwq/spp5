export const MUSEUMS = [
  {
    code: 'AIC',
    name: 'Чикагский институт искусств',
    city: 'Чикаго',
    country: 'США',
    website: 'https://www.artic.edu',
  },
  {
    code: 'CMA',
    name: 'Кливлендский музей искусств',
    city: 'Кливленд',
    country: 'США',
    website: 'https://www.clevelandart.org',
  },
  {
    code: 'SMK',
    name: 'Национальная галерея Дании',
    city: 'Копенгаген',
    country: 'Дания',
    website: 'https://www.smk.dk',
  },
];

export const MUSEUM_CODES = MUSEUMS.map((museum) => museum.code);

export function museumByCode(code) {
  return MUSEUMS.find((museum) => museum.code === code) || null;
}
