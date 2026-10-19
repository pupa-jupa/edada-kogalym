/** Parse only the file format; the server validates the complete batch before saving. */
export function parseOfferImport(text: string): Record<string, unknown>[] {
  if (text.length > 256000) throw new Error('Файл слишком большой: максимум 250 КБ.');
  const content = text.replace(/^\uFEFF/, '').trim();
  if (!content) throw new Error('Файл пуст.');
  let rows: unknown;
  if (content.startsWith('[') || content.startsWith('{')) {
    const parsed: unknown = JSON.parse(content);
    rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).offers : undefined;
  } else {
    const records: string[][] = [];
    let row: string[] = [], field = '', quoted = false, closed = false;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (quoted) {
        if (char === '"' && content[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === ',' || char === '\n' || char === '\r') {
        row.push(field); field = ''; closed = false;
        if (char !== ',') {
          if (char === '\r' && content[i + 1] === '\n') i++;
          if (row.some(value => value.trim())) records.push(row);
          row = [];
        }
      } else if (char === '"') {
        if (field || closed) throw new Error('Некорректные кавычки в CSV.');
        quoted = true;
      } else {
        if (closed) throw new Error('После закрывающей кавычки CSV нужен разделитель.');
        field += char;
      }
    }
    if (quoted) throw new Error('В CSV не закрыты кавычки.');
    row.push(field);
    if (row.some(value => value.trim())) records.push(row);
    const headers = (records.shift() ?? []).map(value => value.trim());
    if (!headers.length || headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('В CSV нужны непустые уникальные заголовки.');
    const numeric = new Set(['price', 'packGrams', 'minPacks', 'kcal', 'protein', 'fat', 'carbs']);
    const boolean = new Set(['localConfirmed', 'nutritionEstimated']);
    rows = records.map((record, index) => {
      if (record.length !== headers.length) throw new Error(`Строка ${index + 2}: число полей не совпадает с заголовком.`);
      const offer: Record<string, unknown> = {};
      const macros: Record<string, number> = {};
      headers.forEach((header, column) => {
        const value = record[column].trim();
        if (numeric.has(header)) {
          if (!value || !Number.isFinite(Number(value))) throw new Error(`Строка ${index + 2}, ${header}: нужно число.`);
          if (['kcal', 'protein', 'fat', 'carbs'].includes(header)) macros[header] = Number(value);
          else offer[header] = Number(value);
        } else if (boolean.has(header)) {
          if (value !== 'true' && value !== 'false') throw new Error(`Строка ${index + 2}, ${header}: используйте true или false.`);
          offer[header] = value === 'true';
        } else if (header !== 'id' || value) offer[header] = value;
      });
      if (Object.keys(macros).length) offer.macros = macros;
      return offer;
    });
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Нужен массив от 1 до 100 объектов предложений или JSON с полем offers.');
  return rows.map(row => ({ ...row, demo: false }));
}
