// See https://aka.ms/new-console-template for more information
Console.WriteLine("Start");
StatLines statLines = new StatLines();
CharacterClass inquisitorFighter = new CharacterClass(1, statLines);
inquisitorFighter.PrintValues();
Console.WriteLine("End");