import type { Migration } from "@shaferllc/keel/core";

const migration: Migration = {
  name: "0002_create_projects",

  async up(schema) {
    await schema.createTable("projects", (t) => {
      t.id();
      t.integer("team_id");
      t.string("name");
      t.timestamps();
    });
  },

  async down(schema) {
    await schema.dropTable("projects");
  },
};

export default migration;
