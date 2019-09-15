exports.up = function (knex, Promise) {
  return knex.schema.raw('ALTER TABLE programs DROP CONSTRAINT programs_pkey');
};

exports.down = function (knex) {
  return knex.schema.table('programs', function (table) {
    table.primary(['spaceName', 'number']);
  })
};
