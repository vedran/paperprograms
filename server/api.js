const express = require('express');
const crypto = require('crypto');

const editorHandleDuration = 1500;

const router = express.Router();
router.use(express.json());
router.use(require('nocache')());

const knex = require('knex')(require('../knexfile')[process.env.NODE_ENV || 'development']);

router.get('/program.:spaceName.:id.js', (req, res) => {
  const { spaceName, id } = req.params;
  knex
    .select('currentCode')
    .from('programs')
    .where({ spaceName, id })
    .then(selectResult => {
      res.set('Content-Type', 'text/javascript;charset=UTF-8');
      res.send(selectResult[0].currentCode);
    });
});

function getSpaceData(req, callback) {
  const { spaceName } = req.params;
  knex('programs')
    .select('id', 'originalCode', 'currentCode', 'printed', 'editorInfo')
    .where({ spaceName })
    .then(programData => {
      knex('pages')
        .select('number', 'programId')
        .where({ spaceName })
        .then(pageData => {
          callback({
            programs: programData.map(program => {
              const editorInfo = JSON.parse(program.editorInfo || '{}');

              return {
                ...program,
                currentCodeUrl: `program.${spaceName}.${program.id}.js`,
                currentCodeHash: crypto
                  .createHmac('sha256', '')
                  .update(program.currentCode)
                  .digest('hex'),
                debugUrl: `/api/spaces/${spaceName}/programs/${program.id}/debugInfo`,
                claimUrl: `/api/spaces/${spaceName}/programs/${program.id}/claim`,
                editorInfo: {
                  ...editorInfo,
                  claimed: !!(
                    editorInfo.time && editorInfo.time + editorHandleDuration > Date.now()
                  ),
                },
                codeHasChanged: program.currentCode !== program.originalCode,
              };
            }),
            pages: pageData,
            spaceName,
          });
        });
    });
}

router.get('/api/spaces/:spaceName', (req, res) => {
  getSpaceData(req, spaceData => {
    res.json(spaceData);
  });
});

const maxNumber = 8400 / 4;
router.post('/api/spaces/:spaceName/pages', (req, res) => {
  const { spaceName } = req.params;

  knex
    .select('number')
    .from('pages')
    .where({ spaceName })
    .then(selectResult => {
      const existingNumbers = selectResult.map(result => result.number);
      const potentialNumbers = [];
      for (let i = 0; i < maxNumber; i++) {
        if (!existingNumbers.includes(i)) potentialNumbers.push(i);
      }
      if (potentialNumbers.length === 0) return res.status(400).send('No more available numbers');
      const number = potentialNumbers[Math.floor(Math.random() * potentialNumbers.length)];

      knex('pages')
        .insert({ spaceName, number })
        .then(() => {
          getSpaceData(req, spaceData => {
            res.json({ number, spaceData });
          });
        });
    });
});

router.put('/api/spaces/:spaceName/programs/:id', (req, res) => {
  const { spaceName, id } = req.params;
  const { code } = req.body;
  if (!code) return res.status(400).send('Missing "code"');

  knex('programs')
    .update({ currentCode: code })
    .where({ spaceName, id })
    .then(() => {
      res.json({});
    });
});

// Assign a program to a page
router.put('/api/spaces/:spaceName/pages/:number/program/:id', (req, res) => {
  const { spaceName, number, id } = req.params;

  knex('pages')
    .update({ programId: id })
    .where({ spaceName, number })
    .then(() => {
      getSpaceData(req, spaceData => {
        res.json(spaceData);
      });
    });
});


// Unassign program from page
router.delete('/api/spaces/:spaceName/pages/:number/program', (req, res) => {
  const { spaceName, number } = req.params;

  knex('pages')
    .update({ programId: null })
    .where({ spaceName, number })
    .then(() => {
      getSpaceData(req, spaceData => {
        res.json(spaceData);
      });
    });
});


router.post('/api/spaces/:spaceName/pages/:number/markPrinted', (req, res) => {
  // TODO: Remove or replace this

  const { spaceName, number } = req.params;
  const { printed } = req.body;
  if (printed === undefined) return res.status(400).send('Missing "printed"');

  knex('pages')
    .update({ printed })
    .where({ spaceName, number })
    .then(() => {
      getSpaceData(req, spaceData => {
        res.json(spaceData);
      });
    });
});

router.put('/api/spaces/:spaceName/programs/:number/debugInfo', (req, res) => {
  const { spaceName, number } = req.params;

  knex('programs')
    .update({ debugInfo: JSON.stringify(req.body) })
    .where({ spaceName, number })
    .then(() => {
      res.json({});
    });
});

router.post('/api/spaces/:spaceName/programs/:number/claim', (req, res) => {
  const { spaceName, number } = req.params;

  knex
    .select(['debugInfo', 'editorInfo'])
    .from('programs')
    .where({ spaceName, number })
    .then(selectResult => {
      if (selectResult.length === 0) return res.status(404);
      const editorInfo = JSON.parse(selectResult[0].editorInfo || '{}');
      if (
        editorInfo.time &&
        editorInfo.time + editorHandleDuration > Date.now() &&
        editorInfo.editorId !== req.body.editorId
      ) {
        res.status(400);
        res.json({});
        return;
      } else {
        knex('programs')
          .update({ editorInfo: JSON.stringify({ ...req.body, time: Date.now() }) })
          .where({ spaceName, number })
          .then(() => {
            res.json({
              debugInfo: JSON.parse(selectResult[0].debugInfo || '{}'),
              editorInfo,
            });
          });
      }
    });
});

module.exports = router;
