
exports.up = function (knex, Promise) {
  knex.schema.table('programs', function (table) {
    table.dropColumn('number');
  });
};

exports.down = function (knex, Promise) {
  knex.schema.table('programs', function (table) {
    table.integer('number').notNullable();
  })
};
