exports.up = function (knex, Promise) {
  return knex.schema.table('programs', function (table) {
    table.increments('id');
  })
};

exports.down = function (knex, Promise) {
  return knex.schema.table('programs', function (table) {
    table.dropColumn('id')
  })
};
