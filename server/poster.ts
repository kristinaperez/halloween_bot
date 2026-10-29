import {readFile} from 'node:fs/promises';
import {asset} from './config.js';

// Круг на обложке 2160x2700: левый верхний угол и диаметр
const LEFT = 27, TOP = 1925, D = 390;

/** Обложка с фото участника в круге. Без фото — готовая обложка с Кристиной. */
export async function makePoster(photo?: Uint8Array): Promise<Uint8Array> {
  if (!photo) return new Uint8Array(await readFile(asset('assets/poster_kristina.jpg')));

  // sharp грузим лениво: если нативная библиотека не загрузится, упадёт только сборка обложки, а не весь бот
  const {default: sharp} = await import('sharp');
  // Поворачиваем по EXIF и берём квадрат: по центру, у вертикальных фото — верхнюю часть, где лицо
  const {data, info} = await sharp(photo).rotate().toBuffer({resolveWithObject: true});
  const side = Math.min(info.width, info.height);
  const left = Math.floor((info.width - side) / 2);
  const top = Math.floor((info.height - side) * 0.25);
  const circle = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
  const face = await sharp(data)
    .extract({left, top, width: side, height: side})
    .resize(D, D)
    .composite([{input: circle, blend: 'dest-in'}])
    .png()
    .toBuffer();

  const out = await sharp(await readFile(asset('assets/cover_ring.jpg')))
    .composite([{input: face, left: LEFT, top: TOP}])
    .jpeg({quality: 88})
    .toBuffer();
  return new Uint8Array(out);
}
