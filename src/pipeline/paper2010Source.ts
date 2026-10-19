import zlib from 'node:zlib';
import { createZipArchive } from './zipSecurity.ts';

/**
 * Verbatim 2010 National Postgraduate Entrance Examination English I Markdown
 * (as contained in 2010英一.zip, without objective answers, reference translations, or sample essays).
 */
export const PAPER_2010_MARKDOWN = `# 2010年全国硕士研究生入学统一考试英语（一）试题

## Section I Use of English

Directions: Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on ANSWER SHEET 1. (10 points)

In 1924, five-year-old studies at the Hawthorne plant of the Western Electric Company near Chicago began to investigate the relationship between working conditions and productivity. The researchers first changed the lighting in the factory to see [1] the workers would react. To their astonishment, productivity [2] whether the照明 (lighting) was made brighter or dimmer, and continued to rise even when the lighting was restored to its original [3].

The researchers then [4] other variables, such as the length of rest breaks, the hours in the working day, and the method of payment. In almost every [5], productivity improved. It seemed that the workers were responding not to the specific changes in their physical [6], but to the fact that they were being [7] by the researchers and felt that their work was considered important. This phenomenon came to be known [8] the "Hawthorne effect" — the idea that people change their behavior simply because they know they are subjects in a [9].

For decades, the Hawthorne effect has been a staple of psychology and management textbooks. [10] in recent years, economists Steven Levitt and John List decided to track down the original data from the 1924–1932 Hawthorne experiments, which had been [11] in archives for decades. When they re-examined the records using modern statistical methods, they [12] a surprising conclusion: the original data provided almost no [13] for the Hawthorne effect as it is commonly described.

According to Levitt and List, the changes in lighting at the Hawthorne plant always took place on Sundays, the only day of the week when the factory was [14]. Output regularly rose on Mondays regardless of whether an experimental change had been [15] the day before. Furthermore, many of the lighting increases occurred as winter turned to spring, when natural daylight and temperatures were also [16] factory output.

Does this mean the Hawthorne effect is a complete [17]? Not necessarily. People do sometimes alter their behavior when they know they are under [18]. However, the original Hawthorne studies were too poorly controlled to [19] what they have long been claimed to show, reminding us that even famous scientific findings deserve [20] scrutiny.

1. [A] what [B] how [C] why [D] when
2. [A] increased [B] declined [C] fluctuated [D] stabilized
3. [A] cost [B] level [C] pattern [D] source
4. [A] eliminated [B] predicted [C] manipulated [D] ignored
5. [A] case [B] stage [C] aspect [D] field
6. [A] health [B] environment [C] capacity [D] security
7. [A] praised [B] replaced [C] observed [D] trained
8. [A] for [B] by [C] to [D] as
9. [A] study [B] contest [C] debate [D] reform
10. [A] Therefore [B] Moreover [C] Yet [D] Indeed
11. [A] lost [B] preserved [C] revised [D] exposed
12. [A] reached [B] challenged [C] confirmed [D] avoided
13. [A] room [B] reason [C] evidence [D] substitute
14. [A] busy [B] noisy [C] closed [D] crowded
15. [A] canceled [B] introduced [C] delayed [D] discussed
16. [A] limiting [B] measuring [C] reducing [D] affecting
17. [A] myth [B] miracle [C] secret [D] tragedy
18. [A] pressure [B] threat [C] control [D] observation
19. [A] conceal [B] prove [C] deny [D] predict
20. [A] casual [B] temporary [C] critical [D] passive

## Section II Reading Comprehension

### Part A

Directions: Read the following four texts. Answer the questions below each text by choosing A, B, C or D. Mark your answers on ANSWER SHEET 1. (40 points)

#### Text 1

Of all the changes that have taken place in English-language newspapers during the past quarter-century, perhaps the most far-reaching has been the inexorable decline in the scope and seriousness of their arts coverage.

It is difficult to the point of impossibility for the average reader under the age of forty to imagine a time when high-quality arts criticism could be found in most big-city newspapers. Yet a considerable number of the most significant collections of criticism published in the 20th century consisted in large part of newspaper reviews. To read such books today is to marvel at the fact that their learned contents were once deemed suitable for publication in general-circulation dailies.

We are even farther removed from the unfocused newspaper reviews published in England between the turn of the 20th century and the eve of World War II, at a time when newsprint was dirt-cheap and stylish arts criticism was considered an ornament to the publications in which it appeared. In those far-off days, it was taken for granted that the critics of major papers would write in detail and at length about the events they covered. Theirs was a serious business, and even those reviewers who wore their learning lightly, like George Bernard Shaw and Ernest Newman, could be trusted to know what they were about. These men believed in journalism as a calling, and were proud to be published in the daily press. "So few authors have brains enough or literary gift enough to keep their own end up in journalism," Newman wrote, "that I am tempted to define 'journalism' as 'a term of contempt applied by writers who are not read to writers who are.'"

Unfortunately, these critics are virtually forgotten. Neville Cardus, who wrote for the Manchester Guardian from 1917 until shortly before his death in 1975, is now known solely as a writer of essays on the game of cricket. During his lifetime, though, he was also one of England's foremost classical-music critics, and a stylisticstylist so widely admired that his Autobiography (1947) became a best-seller. He was knighted in 1967, the first music critic to be so honored. Yet only one of his books is now in print, and his vast body of writings on music is unknown save to specialists.

Is there any chance that Cardus's criticism will enjoy a revival? The prospect seems remote. Journalistic tastes had changed long before his death, and postmodern readers have little use for the richly upholstered Vicwardian prose in which he specialized. Moreover, the amateur tradition in music criticism has been in headlong retreat.

21. It is indicated in Paragraphs 1 and 2 that arts criticism in newspapers
[A] has gained wider popularity among young readers.
[B] has experienced a notable decline in quality and depth.
[C] was once dominated by academic specialists.
[D] focused exclusively on classical literature.

22. Newspaper reviews in England before World War II were characterized by
[A] free themes and casual styles.
[B] elaborate layouts and illustrations.
[C] radical viewpoints and concise language.
[D] thorough analysis and elegant style.

23. Which of the following would Shaw and Newman most probably agree on?
[A] It is writer's duty to fulfill journalistic goals.
[B] It is contemptible for writers to be journalists.
[C] Writers are likely to be tempted into journalism.
[D] Not all writers are capable of journalistic writing.

24. What can be learned about Cardus according to the last two paragraphs?
[A] His music criticism may not appeal to readers today.
[B] His reputation as a music critic has long been in dispute.
[C] His style caters largely to modern specialists.
[D] His writings fail to follow the amateur tradition.

25. What would be the best title for the text?
[A] Newspapers of the Good Old Days
[B] The Lost Horizon in Newspapers
[C] Mournful Decline of Journalism
[D] Prominent Critics in Memory

#### Text 2

Over the past decade, thousands of patents have been granted for what are called business methods. Amazon.com received one for its "one-click" online payment system. Merrill Lynch got legal protection for an asset allocation strategy. One inventor patented a technique for lifting a box.

Now the nation's top patent court appears completely ready to scale back on business-method patents, which have been controversial ever since they were first authorized 10 years ago. In a move that has intellectual-property lawyers abuzz, the U.S. Court of Appeals for the Federal Circuit said it would use a particular case to conduct a broad review of business-method patents. In re Bilski, as the case is known, is "a very big deal," says Dennis D. Crouch of the University of Missouri School of Law. It "has the potential to eliminate an entire class of patents."

Curbs on business-method claims would be a dramatic about-face, because it was the Federal Circuit itself that introduced such patents with its 1998 decision in the so-called State Street Bank case, approving a patent on a way of pooling mutual-fund assets. That ruling produced an explosion in business-method filings, initially by emerging internet companies trying to stake out exclusive rights to specific types of online transactions. Later, more established companies raced to add such patents to their files, if only as a defensive move against rivals that might beat them to the punch. In 2005, IBM noted in a court filing that it had been issued more than 300 business-method patents despite the fact that it questioned the legal basis for granting them. Similarly, some Wall Street investment films armed themselves with patents for financial products, even as they took positions in court cases opposing the practice.

The Bilski case involves a claimed patent on a method for hedging risk in the energy market. The Federal Circuit issued an unusual order stating that the case would be heard by all 12 of the court's judges, rather than a typical panel of three, and that one issue it wants to evaluate is whether it should "reconsider" its State Street Bank ruling.

The Federal Circuit's action comes in the wake of a series of recent decisions by the Supreme Court that have narrowed the scope of protections for patent holders. Last April, for example, the justices signaled that too many patents were being upheld for "inventions" that are obvious. The judges on the Federal Circuit are "reacting to the anti-patent trend at the Supreme Court," says Harold C. Wegner, a patent attorney and professor at George Washington University Law School.

26. Business-method patents have recently aroused concern because of
[A] their limited value to businesses.
[B] their connection with asset allocation.
[C] the possible restriction on their granting.
[D] the controversy over their authorization.

27. Which of the following is true of the Bilski case?
[A] Its ruling complies with the court decisions.
[B] It involves a very big business transaction.
[C] It has been dismissed by the Federal Circuit.
[D] It may change the legal practices in the U.S.

28. The word "about-face" (Line 1, Para. 3) most probably means
[A] loss of good will.
[B] increase of hostility.
[C] change of attitude.
[D] enhancement of dignity.

29. We learn from the last two paragraphs that business-method patents
[A] are immune to legal challenges.
[B] have been often used to sue rivals.
[C] have been skepticism targets of the Supreme Court.
[D] are increasingly favored by the Federal Circuit.

30. Which of the following would be the subject of the text?
[A] A looming threat to business-method patents
[B] The search for a sound patent system
[C] Protection for internet transaction patents
[D] Conflicts between the courts over patents

#### Text 3

In his book The Tipping Point, Malcolm Gladwell argues that "social epidemics" are driven in large part by the actions of a tiny minority of special individuals, often called influentials, who are unusually informed, persuasive, or well-connected. The idea is intuitively compelling, but it doesn't explain how ideas actually spread.

The supposed importance of influentials derives from a plausible-sounding but largely untested theory called the "two-step flow of communication": Information flows from the media to the influentials and from them to everyone else. Marketers have embraced the two-step flow because it suggests that if they can just find and influence the influentials, those select people will propel a product to rapid popularity.

The theory was first proposed in the 1940s by sociologist Paul Lazarsfeld and Elihu Katz, and it seems to make sense. Yet in recent work, sociologist Duncan Watts and his colleagues have tested the two-step flow using mathematical models and computer simulations, and found it lacking. According to Watts, the influentials theory makes a fatal error: It assumes that because certain individuals are present at the beginning of a trend, their exceptional personal qualities must have caused it.

In Watts's simulations, any "global cascade" — a trend that spreads far and wide — depends much more on the overall susceptibility of the population than on the presence of a few super-connected individuals. If society is ready to embrace an idea, almost anyone can start a cascade; if it isn't, even the most influential person will fail. As Watts puts it, if a forest is dry enough, a single spark anywhere can start a wildfire. In fact, <u>these people</u> who initiate a social epidemic often turn out to be ordinary individuals who just happened to be in the right place at the right time.

Of course, some individuals do have more acquaintances than others. Still, in most social networks, even the best-connected person interacts directly with only a tiny fraction of the total population. For a trend to go viral, it must be passed along through chains of ordinary people influencing other ordinary people.

31. By citing the book The Tipping Point, the author intends to
[A] analyze the consequences of social epidemics.
[B] discuss the characteristics of influentials.
[C] exemplify people's intuitive response to social epidemics.
[D] question the conventional view on how trends spread.

32. The author suggests that the "two-step flow theory"
[A] serves as a solution to marketing problems.
[B] has helped explain certain prevalent trends.
[C] has won support from influentials.
[D] requires solid evidence for its validity.

33. What the researchers have observed recently shows that
[A] the power of influence goes with social interactions.
[B] interpersonal links can be enhanced through the media.
[C] influentials have more channels to reach the public.
[D] most celebrities enjoy wide media attention.

34. The underlined phrase "these people" in Paragraph 4 refers to those who
[A] stay outside the network of social influence.
[B] have little contact with the source of information.
[C] are perceived as triggers of a social trend.
[D] are swayed by the pioneers of a social trend.

35. What is the essential element in the dynamics of social influence?
[A] The eagerness to be accepted.
[B] The impulse to influence others.
[C] The readiness to be influenced.
[D] The inclination to rely on others.

#### Text 4

Bankers have been blaming tower-block-high losses on fair-value accounting rules, which require them to value financial assets at current market prices rather than historical cost. Standard-setters, they complain, have trapped them in a vicious circle: falling prices force banks to write down their assets, which triggers panic sales, depressing prices even further.

Politicians have joined the chorus. In October 2008, European leaders threatened to take control of accounting rules unless the International Accounting Standards Board (IASB) quickly relaxed its fair-value requirements. In the United States, Congress pressured the Financial Accounting Standards Board (FASB) into making similar concessions earlier this year.

Yet blaming the messenger does not solve the underlying problem. Fair-value accounting did not cause the housing bubble or the subprime mortgage crisis; lax lending standards and excessive leverage did. Softening the rules merely allows banks to conceal losses on their balance sheets, delaying the painful recognition of bad debts that is essential for restoring confidence in the financial system.

Japan's experience in the 1990s offers a sobering warning. By allowing banks to hide their non-performing loans behind rosy accounting assumptions, regulators prolonged the country's financial paralysis for a decade. Investors, knowing that official balance sheets could not be trusted, refused to provide fresh capital until the true scale of the losses was finally disclosed.

Standard-setters should not be entirely deaf to criticism. They can work to clarify how fair value should be estimated when markets become completely illiquid. However, surrendering their independence to political lobbying and banking industry pressure will only undermine transparency and hurt investors in the long run.

36. Bankers complained that they were forced to
[A] follow unfavorable asset evaluation rules.
[B] collect payments from third parties.
[C] sell their assets at a time of market panic.
[D] re-evaluate their assets in terms of historic cost.

37. According to the author, the rule changes of the board
[A] are crippling the recovering banks.
[B] are aimed at curbing political intervention.
[C] help hide the scale of the banks' troubles.
[D] fail to bring fresh capital into the market.

38. What is the author's attitude towards the standard-setters' compromises?
[A] Approving.
[B] Disapproving.
[C] Objective.
[D] Indifferent.

39. By citing Japan's experience in the 1990s, the author implies that
[A] accounting rules should be strictly enforced.
[B] regulatory bodies should be restructured.
[C] investors' confidence is vital to economic recovery.
[D] banks should be supported by government bailouts.

40. Which of the following is the main point of the last paragraph?
[A] Standard-setters should keep their independence while improving rules.
[B] Politicians should cooperate with standard-setters during crises.
[C] Banks should be given more flexibility in illiquid markets.
[D] Investors' interests must be prioritized over banking stability.

### Part B

Directions: The following paragraphs are given in a wrong order. For Questions 41–45, you are required to reorganize these paragraphs into a coherent article by choosing from the list A–G and filling them into the numbered boxes. Paragraph E has been correctly placed for you. Mark your answers on ANSWER SHEET 1. (10 points)

[A] The first and more important is the consumer's growing preference for eating out: the European market for food and drink consumed outside the home is expanding at the expense of retail food sales. Restaurants, hotels and catering companies have been growing rapidly, creating new demand for specialized food-service wholesalers.

[B] Across Europe, the wholesale food and drink sector is undergoing a quiet transformation. While large supermarket chains have long squeezed traditional wholesalers by dealing directly with manufacturers, structural shifts in consumer habits and supply-chain logistics are opening up new opportunities for agile distributors.

[C] Together, these two trends are reshaping the European food distribution landscape, rewarding wholesalers who can combine broad product ranges with rapid, reliable delivery to fragmented commercial customers.

[D] In contrast, the catering and hospitality sector remains highly fragmented, consisting of hundreds of thousands of independent cafes, restaurants and small hotel groups. Because these small operators cannot negotiate directly with multinational food producers, they rely heavily on wholesalers to source everything from fresh produce to beverages.

[E] In the past, wholesalers were needed to bring goods from manufacturers to a wide network of small independent grocery stores. As giant retail chains consolidated their hold on the grocery market, however, they built their own centralized distribution hubs and bypassed traditional wholesalers altogether.

[F] A second key factor is the increasing complexity of modern retail formats. Even large supermarket groups now operate thousands of small convenience stores in city centers and transport hubs, which lack storage space and require frequent, small-batch deliveries that traditional wholesale networks are well-equipped to handle.

[G] Meanwhile, agricultural subsidies in several non-European regions have altered global grain export prices, prompting overseas farmers to invest in automated harvesting machinery.

Order:
41. → 42. → [E] → 43. → 44. → 45.

### Part C

Directions: Read the following text carefully and then translate the underlined segments into Chinese. Your translation should be written clearly on ANSWER SHEET 2. (10 points)

One basic weakness in a conservation system based wholly on economic motives is that most members of the land community have no economic value. (46) <u>Scientists have painfully learned that the ecological balance of an environment is maintained by the complex interaction of all its plant and animal species, regardless of whether humans find them commercially useful.</u> Yet when an economist or a policymaker evaluates a natural habitat, species without direct market value are routinely treated as dispensable.

When one non-commercial species is threatened with extinction, conservationists are often forced to invent an economic excuse to save it. (47) <u>We tend to manufacture superficial financial arguments for preserving wildflowers or songbirds, so that their survival can be justified in the language of profit and loss.</u> Such excuses are rarely convincing, and they leave the majority of wild species unprotected.

Some biologists have recently discovered that certain obscure insects and fungi play a measurable role in maintaining soil fertility for timber trees. (48) <u>However, a conservation policy driven solely by short-term economic self-interest tends to ignore, and thus eventually to eliminate, many elements of the land community that lack the commercial value to pay their own way.</u>

In Europe and North America, governments have increasingly stepped in to fund wildlife refuges and reforestation programs. (49) <u>This public intervention is carried out on the assumption that the state must perform vital ecological tasks that private landowners would not be done for their own financial gain.</u>

Ultimately, however, government agencies cannot police every acre of forest, wetland, and prairie. (50) <u>An ethical obligation on the part of the private owner is the only visible remedy for these situations, since healthy ecosystems depend on daily stewardship that no law can fully enforce.</u>

## Section III Writing

### Part A

51. Directions:
You are supposed to write for the Postgraduate Association a notice to recruit volunteers for an international conference on globalization, which is to be held at your university. The notice should include the basic information of the conference, the qualifications required for applicants, and the contact information.
You should write about 100 words on ANSWER SHEET 2.
Do not sign your own name at the end of the notice. Use "Postgraduate Association" instead. (10 points)

### Part B

52. Directions:
Write an essay of 160–200 words based on the following drawing. In your essay, you should
1) describe the drawing briefly,
2) explain its intended meaning, and
3) give your comments.
You should write neatly on ANSWER SHEET 2. (20 points)

![2010年写作Part B插图](./2010年写作PartB.png)
`;

/**
 * Generates a valid, high-contrast RGBA PNG buffer illustrating the 2010 Part B
 * "Cultural Hotpot" (文化“火锅”既美味又营养) cartoon diagram.
 * Uses pure Node.js Buffer + zlib so it works in any environment with zero native dependencies.
 */
export function create2010PartBPngBuffer(): Buffer {
  const width = 480;
  const height = 360;
  // Each scanline starts with filter byte 0, followed by width * 4 RGBA bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));

  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const rowStart = y * (1 + width * 4);
    const px = rowStart + 1 + x * 4;
    rawData[px] = r;
    rawData[px + 1] = g;
    rawData[px + 2] = b;
    rawData[px + 3] = 255;
  };

  // Fill warm paper background (#FCFBF9)
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      setPixel(x, y, 252, 251, 249);
    }
  }

  // Draw double border frame (#1C2730)
  for (let x = 16; x < width - 16; x++) {
    setPixel(x, 16, 28, 39, 48);
    setPixel(x, 17, 28, 39, 48);
    setPixel(x, height - 17, 28, 39, 48);
    setPixel(x, height - 16, 28, 39, 48);
  }
  for (let y = 16; y < height - 16; y++) {
    setPixel(16, y, 28, 39, 48);
    setPixel(17, y, 28, 39, 48);
    setPixel(width - 17, y, 28, 39, 48);
    setPixel(width - 16, y, 28, 39, 48);
  }

  // Draw traditional hotpot bowl & central chimney in the center (cx=240, cy=195)
  const cx = 240;
  const cy = 205;
  for (let y = 90; y <= 290; y++) {
    for (let x = 90; x <= 390; x++) {
      const dx = (x - cx) / 135;
      const dy = (y - cy) / 72;
      const dist = dx * dx + dy * dy;

      // Outer pot rim & body
      if (dist >= 0.92 && dist <= 1.02) {
        setPixel(x, y, 28, 39, 48);
      } else if (dist < 0.92 && y > cy - 10) {
        // Pot body shading
        setPixel(x, y, 232, 238, 242);
      } else if (dist < 0.92 && y <= cy - 10 && y >= cy - 55) {
        // Soup surface (#F4F7F8)
        setPixel(x, y, 240, 245, 247);
      }

      // Central hotpot chimney funnel
      const chimDx = Math.abs(x - cx);
      if (y >= 105 && y <= 200) {
        const halfWidth = 14 + Math.floor((y - 105) * 0.14);
        if (Math.abs(chimDx - halfWidth) <= 2) {
          setPixel(x, y, 40, 94, 122);
        } else if (chimDx < halfWidth) {
          setPixel(x, y, 220, 230, 236);
        }
      }
    }
  }

  // Draw rising steam waves above the hotpot
  for (let s = -2; s <= 2; s++) {
    const baseX = cx + s * 38;
    for (let y = 42; y < 105; y++) {
      const waveX = baseX + Math.round(Math.sin(y * 0.14 + s) * 8);
      setPixel(waveX, y, 102, 116, 126);
      setPixel(waveX + 1, y, 102, 116, 126);
    }
  }

  // Draw bottom caption bar
  for (let y = 305; y <= 332; y++) {
    for (let x = 70; x <= 410; x++) {
      if (y === 305 || y === 332 || x === 70 || x === 410) {
        setPixel(x, y, 40, 94, 122);
      } else {
        setPixel(x, y, 244, 247, 248);
      }
    }
  }

  const compressedIdat = zlib.deflateSync(rawData);

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    let crc = 0xffffffff;
    for (let i = 0; i < body.length; i++) {
      crc ^= body[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([lenBuf, body, crcBuf]);
  };

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressedIdat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Creates the complete binary buffer for `2010英一.zip` containing:
 * 1. `2010年考研英语一真题.md`
 * 2. `2010年写作PartB.png`
 */
export function build2010InitialZipBuffer(): Buffer {
  return createZipArchive([
    {
      fileName: '2010年考研英语一真题.md',
      data: Buffer.from(PAPER_2010_MARKDOWN, 'utf8'),
    },
    {
      fileName: '2010年写作PartB.png',
      data: create2010PartBPngBuffer(),
    },
  ]);
}
