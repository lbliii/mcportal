/** Shared print-shop plates. Loaded by the room and the server, never user CSS. */
const spaceInks = (() => {
  const sets = [
    { name: 'atomic', colors: ['#F2E6CF', '#2A8C82', '#E0A526', '#1F2A36', '#C4452C'] },
    { name: 'space-age', colors: ['#EFE3C8', '#E2692A', '#3FA7A0', '#1E2F4F', '#F2C230'] },
    { name: 'pulp', colors: ['#F4E4C1', '#2B5C8A', '#D2402F', '#1B2330', '#F2C230'] },
    { name: 'olive-drab', colors: ['#EDE2C6', '#7A8B3A', '#C8622B', '#3E2C22', '#E9B949'] },
    { name: 'pink-moon', colors: ['#F3E1D3', '#5B3558', '#E27A73', '#2A1C2B', '#8CC6A8'] },
    { name: 'mars', colors: ['#F0DDC2', '#B5482E', '#E3B070', '#3A2A3F', '#5FA8A0'] },
    { name: 'mission', colors: ['#ECE6D6', '#1F4E8C', '#9AA3A6', '#17202E', '#D8432E'] },
    { name: 'harbor', colors: ['#E9E4D4', '#2F7F9A', '#EFB23C', '#243447', '#D9603B'] },
  ];
  const motifs = ['arches', 'orbits', 'portal', 'gravity', 'doorway'];
  const formats = ['paperback', 'magazine', 'patch'];
  const stamps = ['charter', 'brought', 'signal', 'volume'];
  return { sets, motifs, formats, stamps };
})();
