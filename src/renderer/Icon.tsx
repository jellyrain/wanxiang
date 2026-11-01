import React from 'react';
const paths: Record<string,string[]> = {
  item:['m12 3 9 5v9l-9 5-9-5V8Z','m3 8 9 5 9-5','M12 13v9','m7.5 5.5 9 5V15'],
  technique:['M6 3h12v15H6Z','M6 3H4a2 2 0 0 0 0 4h2','M18 18h2a2 2 0 0 1 0 4H8a2 2 0 0 1-2-2v-2','M9 7h6','M9 11h6','M9 15h3'],
  place:['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z','m8 10 4-3 4 3','M9 10v5h6v-5','M12 12v3'],
  hand:['M5 11V7a2 2 0 0 1 4 0v4-7a2 2 0 0 1 4 0v7-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 5-3 7-7 7h-1c-3 0-5-2-7-5l-3-4a2 2 0 0 1 2-3l4 4'],
  pin:['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z','M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  forest:['m8 3-6 11h4l-3 5h10l-3-5h4Z','M8 19v3','m16 3 6 11h-4l3 5h-6','M17 19v3'],
  mountain:['m2 20 7-16 7 16Z','m13 13 4-8 6 15h-7','m6 11 3 3 3-3'],
  river:['M9 2c8 5-8 6 0 10s-7 5 1 10','M15 2c8 5-8 6 0 10s-7 5 1 10'],
  route:['M4 4h5a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h12','m17 17 3 3-3 3'],
  eraser:['m15 3 6 6-11 12H5l-4-4Z','m8 10 7 7','M10 21h12'],
  undo:['M3 5v6h6','M3 11a9 9 0 1 1 2 7'],redo:['M21 5v6h-6','M21 11a9 9 0 1 0-2 7'],
  star:['m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'],
  expand:['M8 3H3v5','M16 3h5v5','M3 16v5h5','M21 16v5h-5'],
  collapse:['M3 8h5V3','M21 8h-5V3','M8 21v-5H3','M16 21v-5h5'],
  lock:['M5 10h14v11H5Z','M8 10V6a4 4 0 0 1 8 0v4','M12 14v3'],
  radar:['M12 2 22 9 18 21H6L2 9Z','M12 2v10l10-3','m18 21-6-9L6 21','M2 9l10 3','m12 6 5 5-2 5H9l-2-5Z'],
  tag:['M3 3h8l10 10-8 8L3 11Z','M7 7h.01'],
  palette:['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z','M7 10h.01','M10 6.5h.01','M15 7h.01','M6.5 14h.01'],
  users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M16 3a4 4 0 0 1 0 8','M22 21v-2a4 4 0 0 0-3-3.87'],
  search:['m21 21-4.3-4.3'], plus:['M12 5v14','M5 12h14'], close:['m6 6 12 12','M6 18 18 6'],
  back:['m12 5-7 7 7 7','M5 12h14'], arrow:['M5 12h14','m12 5 7 7-7 7'], down:['m6 9 6 6 6-6'],
  pen:['m16 3 5 5-12 12-6 1 1-6Z','m14 5 5 5'], grid:['M3 3h7v7H3z','M14 3h7v7h-7z','M3 14h7v7H3z','M14 14h7v7h-7z'],
  list:['M8 6h13','M8 12h13','M8 18h13','M3 6h.01','M3 12h.01','M3 18h.01'],
  book:['M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z','M12 5v16'],
  image:['M3 3h18v18H3z','m3 17 6-6 4 4 3-3 5 5'], archive:['M3 4h18v4H3z','M5 8v12h14V8','M10 12h4'],
  world:['M12 2c6 5 6 15 0 20-6-5-6-15 0-20','M2 12h20'], network:['M7 6h10','m6 8 6 10 6-10'],
  history:['M3 11a9 9 0 1 1 2 7','M3 4v7h7','M12 7v5l3 2'], check:['m5 12 4 4L19 6'],
  folder:['M3 5h6l2 3h10v12H3z'],
  settings:['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z','M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8'],
  sliders:['M4 3v6m0 4v8M12 3v10m0 4v4M20 3v2m0 4v12','M1 9h6v4H1zM9 13h6v4H9zM17 5h6v4h-6z'],
  info:['M12 11v6','M12 7h.01']
};
export function Icon({ name }: { name: string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]?.map((d,i) => <path key={i} d={d} />)}
    {name === 'users' && <circle cx="9" cy="7" r="4" />}{name === 'search' && <circle cx="10.5" cy="10.5" r="7.5" />}
    {['world','info'].includes(name) && <circle cx="12" cy="12" r="10" />}
    {name === 'image' && <circle cx="8" cy="8" r="1" />}
    {name === 'network' && <><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="12" cy="20" r="3"/></>}
  </svg>;
}
