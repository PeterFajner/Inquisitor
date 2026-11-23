public static class GenerateAttributes {
    public static Random rnd = new Random();
    
    public static int CalculateAttribute(int[] values) {
        int baseStat = values[0];
        int diceNum = values[1];
        int diceSize = values[2];
        int diceRoll = 0;
        for (int i = 0; i < diceNum; i++) {
            diceRoll += rnd.Next(1, diceSize);
        }
    return baseStat + diceRoll;
    }
}