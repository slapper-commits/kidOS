// Original kidOS lessons. Factual references and licensing are in README.md.
export const SITES = [
  {
    id: 'science', name: 'Little Science Lab', category: 'Science', symbol: '◌', color: 'blue',
    description: 'Follow a drop of water. Ask a question, then try a prediction.',
    title: 'Where did the puddle go?', eyebrow: 'A question for a curious afternoon',
    paragraphs: [
      'A puddle can get smaller even when nobody drinks it. Some liquid water becomes water vapor in the air. We call that change evaporation.',
      'Water vapor can become tiny liquid drops again through condensation. Water keeps moving between air, land, living things and the ocean. The water cycle has many paths; it is not one tidy circle.',
    ],
    activity: 'Look at a puddle with a grown-up. Draw its outline from a dry place, then look again later. What changed? Do not taste the water.',
    question: 'Liquid water becomes water vapor. Which change is that?',
    choices: [['evaporation', 'Evaporation'], ['condensation', 'Condensation']],
    answers: { evaporation: 'Yes! Evaporation takes liquid water into the air as water vapor.', condensation: 'Try reversing the arrow: condensation changes water vapor into liquid drops. Liquid becoming vapor is evaporation.' },
    source: 'Fact check: NOAA Education, The water cycle.', related: ['nature', 'space'],
  },
  {
    id: 'space', name: 'Moon Post', category: 'Space', symbol: '☾', color: 'violet',
    description: 'Visit our nearest space neighbor and discover borrowed light.',
    title: 'The Moon borrows its glow', eyebrow: 'Postcards from the sky',
    paragraphs: [
      'The Moon is Earth’s natural satellite: it travels around Earth. The bright part we see is lit by the Sun. Moonlight is reflected sunlight.',
      'As the Moon travels around Earth, our view of its sunlit part changes. That gives us the Moon’s phases. The far side is not always dark; different parts receive sunlight at different times.',
    ],
    activity: 'Sketch the Moon when you can see it, then look again on another evening with a grown-up. Label each drawing with the date. Never look directly at the Sun.',
    question: 'Where does the Moon’s visible glow come from?',
    choices: [['sun', 'Reflected sunlight'], ['lamp', 'A giant lamp inside']],
    answers: { sun: 'You found it: the Moon reflects sunlight. A bright object does not always make its own light.', lamp: 'That would make a funny story! The real Moon reflects light from the Sun.' },
    source: 'Fact check: NASA Science, Moon Facts and Top Moon Questions.', related: ['science', 'newspaper'],
  },
  {
    id: 'nature', name: 'Small Wonders', category: 'Nature', symbol: '✿', color: 'green',
    description: 'Meet flower visitors and practice looking closely.',
    title: 'A flower has visitors', eyebrow: 'The world just outside',
    paragraphs: [
      'A bee visiting a flower may carry pollen to another flower. Moving pollen helps many plants make seeds. Bees, butterflies, birds and other animals can be pollinators.',
      'Not every plant needs an animal helper. Some plants use wind or water to move pollen, and some can pollinate themselves. Looking closely often uncovers more than one answer.',
    ],
    activity: 'Watch a flower from a little distance. Keep hands away from its visitors. Count visits for one minute, then draw what you noticed. No flowers nearby? Draw an imaginary garden and label it imaginary.',
    question: 'Which observation could you check by watching a flower?',
    choices: [['visits', 'How many visitors arrive in one minute'], ['best', 'Which flower is the best in the whole world']],
    answers: { visits: 'Good observation question. You can count visits and compare what you saw with someone else.', best: '“Best” depends on what you like. For a checkable observation, try counting flower visitors for one minute.' },
    source: 'Fact check: U.S. National Park Service, About Pollinators.', related: ['science', 'personal'],
  },
  {
    id: 'newspaper', name: 'The Little Gazette', category: 'Newspaper', symbol: '▤', color: 'orange',
    description: 'An original practice newspaper about questions, clues and opinions.',
    title: 'Tiny reporters, big questions', eyebrow: 'Practice edition · an invented story, not live news',
    paragraphs: [
      'In our made-up town of Button Bay, a reporter sees three paper boats beside a puddle. “Three boats,” she writes in her notebook. Her friend says, “The yellow boat is the loveliest.” Both sentences belong in a story, but they do different jobs.',
      'The number is an observation someone else could check. “Loveliest” is an opinion about what the friend likes. A careful reporter tells readers what was seen, who said something, and what is still unknown.',
    ],
    activity: 'Choose an object nearby. Write one thing you can count or measure, then one thing you like about it. Give the two sentences different labels: observation and opinion.',
    question: '“The yellow boat is the loveliest.” What kind of sentence is it?',
    choices: [['opinion', 'An opinion'], ['count', 'A counted observation']],
    answers: { opinion: 'Exactly. It tells us what someone likes. Another person might choose a different boat.', count: 'The sentence does not count anything. “Loveliest” tells us someone’s opinion.' },
    source: 'Original kidOS fiction and activity. Button Bay and its newspaper are invented.', related: ['nature', 'workshop'],
  },
  {
    id: 'workshop', name: 'The Web Workshop', category: 'Workshop', symbol: '⌘', color: 'teal',
    description: 'Pull back the curtain on pages, links, requests and responses.',
    title: 'Hello, little web server', eyebrow: 'How this very page arrived',
    paragraphs: [
      'Opening this page sent an HTTP request to the web server running on this computer. The server answered with HTML. Your browser reads that document and draws the page.',
      'A GET request asks for something, such as a page or some JSON data. A POST request sends data, such as the choice in a form. The response includes a status code: 200 means this request succeeded. Try the Request lab in Explore to send a real request and see its answer.',
    ],
    activity: 'Open Request lab. Send “Read Moon facts,” then “Send a prediction.” Compare the method, response type and body. The addresses start with 127.0.0.1 because these requests stay on this computer.',
    question: 'Which method asks the server to read a page?',
    choices: [['GET', 'GET'], ['POST', 'POST']],
    answers: { GET: 'Yes. GET retrieves a resource. This form itself arrived by POST, because it sent your choice to the server.', POST: 'POST sends data for the server to process. GET is the method normally used to retrieve a page.' },
    source: 'Protocol reference: MDN Web Docs, Overview of HTTP.', related: ['personal', 'science'],
  },
  {
    id: 'personal', name: 'A Little Homepage', category: 'Personal site', symbol: '⌂', color: 'rose',
    description: 'A made-up explorer’s corner of the web. Pick a badge and say hello.',
    title: 'Hello from Pebble!', eyebrow: 'An example homepage · Pebble is an invented character',
    paragraphs: [
      'I collect questions instead of answers. Why does the Moon change shape? Who visited that flower? What can I make from a blank page? My favorite part of exploring is finding a new question.',
      'This little homepage is a sample, with no real child’s name, photo or contact details. A personal website can have a welcome, things you enjoy and links to other pages. You can make your own local HTML app in My Stuff.',
    ],
    activity: 'Sketch a homepage on paper. Give it a made-up character, three interests and a title. Start with an imaginary character while you learn how sharing works.',
    question: 'Choose a visitor badge for this page.',
    choices: [['moon', 'Moon watcher'], ['flower', 'Flower spotter'], ['maker', 'Page maker']],
    answers: { moon: 'Welcome, Moon watcher! Your next stop could be Moon Post.', flower: 'Welcome, Flower spotter! Small Wonders has a question for you.', maker: 'Welcome, Page maker! The Web Workshop will show you how requests work.' },
    source: 'Original kidOS fiction and activity. No real household data.', related: ['space', 'workshop'],
  },
];

export const MOON_FACTS = Object.freeze({ name: 'Moon', orbits: 'Earth', kind: 'natural satellite', visibleLight: 'reflected sunlight', source: 'NASA Science: Moon Facts and Top Moon Questions' });
