/** Doublure de SheetJS : l'export tableur n'est pas jugé par cette porte. */
window.XLSX = {
  utils: { book_new: function () { return {} }, book_append_sheet: function () {}, json_to_sheet: function () { return {} }, aoa_to_sheet: function () { return {} } },
  writeFile: function () {}, write: function () { return '' }, read: function () { return { SheetNames: [], Sheets: {} } }
};
