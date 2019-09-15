exports.up = function (knex, Promise) {
  return knex.schema.createTable('pages', function (table) {
    table.string('spaceName').notNullable();
    table.integer('number').notNullable();
    table.integer('programId');
    table.foreign('programId').references('programs.id');
    table.primary(['spaceName', 'number']);
  })
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('pages');
};