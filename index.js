const express = require('express');
const pug = require('pug');
const uuidv4 = require('uuid/v4');

const app = express();

// Continuation handling logic

const MAX_CONTINUATIONS = 100;
const continuations = {};
const uuids = [];

function sendSuspend(res, responseGenerator) {
  const continuationID = uuidv4();
  uuids.push[continuationID];

  // Maintain max of MAX_CONTINUATIONS stored promise-resolving functions
  while(uuids.length > MAX_CONTINUATIONS) {
    const oldestUUID = uuids.shift();
    delete continuations[oldestUUID];
  }

  const continueURL = "/continue/" + continuationID;
  res.send(responseGenerator(continueURL));
  
  return new Promise((resolve, reject) => { continuations[continuationID] = resolve; });
}

function renderTemplate(filename, options = {}) {
  options.cache = true;
  options.filename = filename;
  return pug.renderFile(filename, options);
}

function sendSuspendTemplate(res, filename, options = {}) {
  return sendSuspend(res, continueURL => {
    options.continueURL = continueURL;
    return renderTemplate(filename, options);
  });
}

app.all('/continue/:continuationID', (req, res) => {
  const continuation = continuations[req.params.continuationID];
  if(continuation !== undefined) {
    delete continuations[req.params.continuationID];
    continuation([req, res]);
  }
  else res.send("Sorry, your session has expired or is invalid.");
});

// Application logic

app.get("/new", async function(req, res) {
  [req, res] = await sendSuspendTemplate(res, "new-quiz.pug", { title: "Create a new quiz" });
  const quiz = { title: req.query.quizTitle, questions: [] };

  while(true) {
    [req, res] = await sendSuspendTemplate(res, "quiz-overview.pug", { quiz: quiz, title: "Overview" });

    if(req.query.addQuestion) {
      switch(req.query.type) {
        case "free":
          [req, res] = await sendSuspendTemplate(res, "add-question.pug", {
             quiz: quiz, title: "Add a new question"
          });
          quiz.questions.push({ text: req.query.question, answer: req.query.answer });
          break;

        case "multiple":
          const question = { type: 'multiple', answers: [] };

          while(true) {
            [req, res] = await sendSuspendTemplate(res, "add-multiple-choice.pug", {
              quiz: quiz, title: "Add a multiple choice question", question: question
            });
            if(req.query.answer !== "") {
              question.answers.push({ text: req.query.answer, correct: req.query.correct });
            } else break;
          }

          quiz.questions.push(question);
          break;
      }

      continue;
    } else if (req.query.playQuiz) {
      playQuiz(res, quiz);
    } else if (req.query.download) {
      res.send("Placeholder: download quiz");
    }

    break;
  }
});

async function playQuiz(res, quiz) {
  const stats = [];

  for(const question of quiz.questions) {
    const startTime = Date.now();
    [req, res] = await sendSuspendTemplate(res, "present-question.pug", {
      title: quiz.title,
      question: question
    });

    const responseTime = (Date.now() - startTime) / 1000;
    stats.push({
       question: question, responseTime: responseTime, correct: req.query.answer == question.answer
    });

    [req, res] = await sendSuspendTemplate(res, "feedback.pug", {
      title: `${quiz.title} - Feedback`,
      responseTime: responseTime,
      userAnswer: req.query.answer,
      question: question
    });
  }

  res.send("Finished");
}

app.get('/', (req, res) => {
  res.send(renderTemplate("home.pug", { title: "Quizomatic! Prototype" }));
});
  
app.listen(3000, () => { console.log('server started'); });