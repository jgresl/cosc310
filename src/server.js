const express = require('express');
var cors = require('cors');
var fs = require('fs');
var Papa = require('papaparse');
var {
  WordTokenizer,
  Spellcheck,
  PorterStemmer,
  Lexicon,
  RuleSet,
  BrillPOSTagger,
  SentimentAnalyzer,
  NGrams
} = require('natural');
var synonyms = require('synonyms');
const readline = require('readline');

const app = express();
app.use(cors());
app.listen(17000);

app.get('/', function(req, res) {
  //console.log("I got a message!");
  res.send(GetResponse(req.query.input, req.query.lastResponse));
});

class TreeNode {
  constructor(data) {
    this.data = data;
    this.children = [];
    this.getSubTree = this.getSubTree.bind(this);
  }

  // returns the first child with matching data
  getSubTree(data) {
    return this.children.find(child => {
      return child.data === data;
    });
  }
}

var dictionary = [];
LoadDictionary();
var responseTree = GenerateTree('../public/treeinput.csv');

// generate the response tree from a CSV-formatted text input
function GenerateTree(fileName) {
  let root = new TreeNode('root');

  // for each line in the csv input, read as array of strings
  ParseCSV(fileName).then(data => {
    data.forEach(row => {
      // don't count empty rows
      if (row[0].trim() === '') {
        return;
      }

      let parent = root;

      // for each string in each subarray, add to tree
      row.forEach(txt => {
        // if the text contains only 1 word, make it lowercase
        if (txt.split(' ').length === 1) {
          txt = txt.toLowerCase();
        }

        // check if the string already exists in the tree
        let node = parent.getSubTree(txt);

        // add the string to the tree if needed
        if (!node) {
          node = new TreeNode(txt);
          parent.children.push(node);
        }

        parent = node;
      });
    });
  });
  // .then(() => PrintTree(root));

  return root;
}

// a helper function that wraps the Papa.parse function
// and returns a Promise with the CSV array data.
function ParseCSV(fileName) {
  return new Promise(function(resolve, reject) {
    let stream = fs.createReadStream(fileName);
    Papa.parse(stream, {
      complete: function(results, file) {
        resolve(results.data);
      },
      error: function(error, file) {
        reject(error);
      }
    });
  });
}

// a DFS recursive printing function for the response tree
function PrintTree(root) {
  console.log(root.data);
  root.children.forEach(child => {
    PrintTreeRecursive(child, 1);
  });
}

// recursive helper method for PrintTree
function PrintTreeRecursive(node, level) {
  let indent = '';
  for (let i = 0; i < level; i++) {
    indent += '.';
  }
  console.log(indent + node.data);
  node.children.forEach(child => {
    PrintTreeRecursive(child, level + 1);
  });
}

// returns a string response from the response tree based on the inputText
function GetResponse(inputText, lastResponse) {
  let responseList = [];
  let processedInput = ProcessInput(inputText);

  // determine the type of input (question or statement)
  let category = IsQuestion(inputText) ? 'q' : 's';
  let categoryTree = responseTree.getSubTree(category);

  // determine the sentiment of input (positive or negative)
  let sentiment = GetSentiment(processedInput) >= 0 ? 'p' : 'n';
  let sentimentTree = categoryTree.getSubTree(sentiment);

  // get each matched topic in the response tree and
  // add all the possible responses to the response list
  processedInput.forEach(input => {
    let topicTree = sentimentTree.getSubTree(input);
    if (topicTree !== undefined) {
      topicTree.children.forEach(topic => {
        responseList.push(topic.data);
      });
    }
  });

  // add generic responses if no topics matched
  if (responseList.length === 0) {
    let topicTree = sentimentTree.getSubTree('');
    topicTree.children.forEach(topic => {
      responseList.push(topic.data);
    });
  }

  // remove duplicate responses
  let uniqueSet = new Set(responseList);
  responseList = [...uniqueSet];

  // prevent repeating the last response we used if possible
  if (responseList.length > 1 && lastResponse !== undefined) {
    let idx = responseList.findIndex(data => {
      return data === lastResponse;
    });
    if (idx !== -1) {
      responseList.splice(idx, 1);
    }
  }

  // return a random response from the possible responses
  return GetRandomElement(responseList);
}

// returns a random element from an array
function GetRandomElement(arr) {
  let rand = Math.floor(Math.random() * arr.length);
  return arr[rand];
}

function ProcessInput(txt) {
  let tokenizedString = TokenizeString(txt);
  let spellChecked = SpellcheckInput(tokenizedString);
  let synonyms = GetSynonyms(spellChecked);
  console.log(synonyms);
  let result = spellChecked.concat(synonyms);
  return result.map(str => { return str.toLowerCase() });
}

// split string into a tokenized array of strings
function TokenizeString(txt) {
  // currently uses 'natural' library
  let tokenizer = new WordTokenizer();
  let tokenArray = tokenizer.tokenize(txt);
  return tokenArray;
}

// split string into stemmed array of strings, also removes stopwords
function TokenizeAndStem(txt) {
  PorterStemmer.attach();
  return txt.tokenizeAndStem();
}

// returns whether an input sentence is a question
// TODO: should be updated to use a library instead
function IsQuestion(txt) {
  return txt.charAt(txt.length - 1) === '?';
}

// input sentence and return array of words including original words, first match to each word of length 3 that is in dictionary
function SpellcheckInput(tokenizedString) {
  var spellchecker = new Spellcheck(dictionary);
  let result = [];
  tokenizedString.forEach(str => {
    if (str.length > 3) {
      if (!dictionary.includes(str)) {
        let corrections = spellchecker.getCorrections(str, 2);
        if (corrections.length > 0) {
          result.push(corrections[0]);
        }
      }
    }
  });
  return tokenizedString.concat(result);
}

//input array of tokens, return JSON with token and POS tag
function POSTagger(tokenizedString) {
  const language = '../node_modules/natural/lib/natural/brill_pos_tagger/data/English/lexicon_from_posjs.json';
  const rules = '../node_modules/natural/lib/natural/brill_pos_tagger/data/English/tr_from_posjs.txt';
  const defaultCategory = 'N';
  const defaultCategoryCapitalized = 'NNP';

  let lexicon = new Lexicon(language, defaultCategory, defaultCategoryCapitalized);
  let ruleSet = new RuleSet(rules);
  let tagger = new BrillPOSTagger(lexicon, ruleSet);
  return tagger.tag(tokenizedString);
}

//input array of strings, returns range of [-5,5] based on positive/negative sentiment of input (normalized so will likely land between [-1,1] unless explicitly positive/negative)
function GetSentiment(tokenizedString) {
  let analyzer = new SentimentAnalyzer('English', PorterStemmer, 'afinn');
  return analyzer.getSentiment(tokenizedString);
}

//input string and output array of bigrams
function Ngrams(sentence) {
  return NGrams.bigrams(sentence);
}

function GetWordSynonyms(word) {
  let nSyns = synonyms(word, 'n') || [];
  let nSynsMax3 = nSyns.slice(0, 3);
  let vSyns = synonyms(word, 'v') || [];
  let vSynsMax3 = vSyns.slice(0, 3);
  return nSynsMax3.concat(vSynsMax3);
}

function GetRelevantPOS(tokenizedString) {
  let tagged = POSTagger(tokenizedString);
  let tagArr = ['NN', 'NNS', 'NNP', 'NNPS', 'VB', 'VDB', 'VBN', 'VBP', 'VBD', 'VBZ'];
  let result = [];
  tagged.taggedWords.forEach(word => {
    let tag = word.tag.toString();
    if (tagArr.includes(tag)) {
      result.push(word.token);
    }
  });
  return result;
}

//takes inputted sentence and returns array of strings with all original nouns, verbs and synonyms
function GetSynonyms(tokenizedString) {
  // Gets the nouns and verbs from a sentence
  let pos = GetRelevantPOS(tokenizedString);
  let result = [];
  pos.forEach(word => {
    let wordSynonyms = GetWordSynonyms(word);
    wordSynonyms.forEach(f => result.push(f));
  });
  return result;
}

function LoadDictionary() {
  let fileName = '../public/dictionary.dic';
  const readInterface = readline.createInterface({
    input: fs.createReadStream(fileName),
    output: process.stdout,
    terminal: false
  });
  readInterface.on('line', function(line) {
    dictionary.push(line);
  });
}

function examples() {
  const exStr = 'This is a sentence about a lovely goat named Billy and his friend named Wendy.';
  const exStr2 = 'Ugh I hate stupid evil trolls.';
  const exStr3 = 'donld';
  let tokens = TokenizeString(exStr);
  let tokens2 = TokenizeString(exStr2);
  console.log(`Sentence 1: ${exStr}\nSentence 2: ${exStr2}\nSentence 3: ${exStr3}\nSentiment:`);
  console.log(GetSentiment(tokens));
  console.log(GetSentiment(tokens2));
  console.log('Bigrams\n', Ngrams(exStr));
  console.log('POSTagger\n', POSTagger(tokens));
  console.log('Spellcheck sentence 3:\n', SpellcheckInput(exStr3));
  console.log('TokenizeString:\n', tokens);
  console.log('TokenizeAndStem:\n', TokenizeAndStem(exStr));
}
