using System.Collections.Generic;
public class CharacterClass {

    // Variables
    int classId;
    string name;
    Dictionary<string, int> attributes;
    object[] equipment;
    object armor;
    object[] psychicAbilities;

    object[] exoticAbilities;
    object[] talents;
    object[] mutations;
    int alignment;
    string beliefFaction;
    public StatLines statLines;
    public CharacterClass(int classId, StatLines statLines) {
        this.classId = classId;
        this.statLines = statLines;
        StatBlock statBlock = statLines.GetStats(classId);
        name = statBlock.GetName();
        attributes = new Dictionary<string, int>();
        foreach(KeyValuePair<string, int[]> stat in statBlock.GetStats()) {
            attributes.Add(stat.Key, GenerateAttributes.CalculateAttribute(stat.Value));
        }
    }

    public void PrintValues() {
        foreach(KeyValuePair<string, int> pair in attributes) {
           Console.WriteLine(pair.Key + " : " + pair.Value);
        }
    }
}