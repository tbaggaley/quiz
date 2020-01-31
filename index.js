const express = require('express');
const pug = require('pug');
const uuidv4 = require('uuid/v4');
const fileUpload = require('express-fileupload');
const escape = require('escape-html');

const app = express();
app.use(fileUpload());

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
  else res.send("Sorry, your session has expired or is invalid. <a href='/'>Start again</a>");
});

// Application logic

const questionTypes = {};

function registerQuestionType(typename, methods) {
  questionTypes[typename] = {
    type: typename,
    name: methods.name,
    description: methods.description,
    mark: methods.mark,
    present: methods.present,
    overview: methods.overview,
    create: async (req, res) => {
      [res, question] = await methods.create(req, res);
      return [res, Object.assign(question, { type: typename})];
    }
  }
};

registerQuestionType("free", {
  name: "Free text",
  description: "Enter text freely and mark it against the expected answer",
  create: async (req, res) => {
    [req, res] = await sendSuspendTemplate(res, "add-question.pug", { title: "Add a new question" });
    return [res, {
      text: req.query.question,
      answer: req.query.answer
    }];
  },
  present: (question) => "present-free-text.pug",
  overview: (question) => `${escape(question.text)} -> ${escape(question.answer)}`,
  mark: (question, answer) =>  question.answer.toLowerCase() === answer.toLowerCase()
});

registerQuestionType("multiple", {
  name: "Multiple choice",
  description: "A multiple choice question - choose one answer from a set of five.",
  create: async(req, res) => {
    [req, res] = await sendSuspendTemplate(res, "add-multiple-choice.pug", {
      title: "Add a multiple choice question"
    });
    return [res, {
      text: req.query.question,
      answer: req.query.correctIndex,
      choices: ["choice1", "choice2", "choice3", "choice4", "choice5"].map(key => req.query[key])
    }];
  },
  present: (question) => "present-multiple-choice.pug",
  overview: (question) => `${escape(question.text)} <ol>${question.choices.map(choice => `<li>${escape(choice)}</li>`).join("")}</ol>
                          <p>Correct choice: ${question.answer}`,
  mark: (question, answer) => question.answer == answer
});

app.get("/load", async function(req, res) {
  [req, res] = await sendSuspendTemplate(res, "load-quiz.pug", { title: "Load a quiz from file" });
  const quiz = JSON.parse(req.files.file.data);
  manageQuiz(res, quiz);
});

app.get("/new", async function(req, res) {
  [req, res] = await sendSuspendTemplate(res, "new-quiz.pug", { title: "Create a new quiz" });
  const quiz = { title: req.query.quizTitle, questions: [] };
  manageQuiz(res, quiz);
});

async function manageQuiz(res, quiz) {
  while(true) {
    [req, res] = await sendSuspendTemplate(res, "quiz-overview.pug", { 
      quiz: quiz, title: "Overview",  downloadLink: jsonToDataURI(JSON.stringify(quiz)), questionTypes: questionTypes
    });

    if(req.query.addQuestion) {
      [res, question] = await questionTypes[req.query.type].create(req, res);
      quiz.questions.push(question);
    } else if (req.query.playQuiz) {
      return playQuiz(res, quiz);
    }
  }
}

function jsonToDataURI(json) {
  // Return a data: URI (suitable for using in <a href='...' download>) given a JSON string
  return "data:application/json;base64," + Buffer.from(json).toString("base64");
}

async function playQuiz(res, quiz) {
  while(true) {
    const stats = [];
  
    for(const question of quiz.questions) {
      const startTime = Date.now();
      
      [req, res] = await sendSuspendTemplate(res, questionTypes[question.type].present(question), {
        title: quiz.title,
        quiz: quiz,
        question: question
      });
  
      const responseTime = (Date.now() - startTime) / 1000;
      const correct = questionTypes[question.type].mark(question, req.query.answer);
  
      stats.push({
        question: question, responseTime: responseTime, correct: correct
      });
  
      [req, res] = await sendSuspendTemplate(res, "feedback.pug", {
        title: quiz.title,
        correct: correct,
        responseTime: responseTime,
        userAnswer: req.query.answer,
        question: question
      });
    }

    const add = (a,b) => a+b;
    const answersCorrect = stats.map(stat => stat.correct).reduce(add);
    const totalTime = stats.map(stat => stat.responseTime).reduce(add);

    [req, res] = await sendSuspendTemplate(res, "finished-quiz.pug", {
      title: quiz.title, answersCorrect: answersCorrect, totalTime: totalTime, totalQuestions: stats.length,  
    }); 

    // Allow returning to overview page for now
    if(req.query.overview) return manageQuiz(res, quiz);
  }
}

// Homepage
app.get('/', (req, res) => res.send(renderTemplate("home.pug", { title: "Quiz Prototype" })));
  
app.listen(3000, () => { console.log('server started'); });