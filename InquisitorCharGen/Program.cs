using System;
using System.Windows.Forms;
using System.Drawing;

namespace program{
    class program{
        private static void Main(){
            Form mainForm = new Form();
            Label lblFirst = new Label();
            mainForm.Width = 300;
            mainForm.Height = 400; 
            lblFirst.Text = "Hello World";
            lblFirst.Location = new Point(150,200);
            mainForm.Controls.Add(lblFirst);
            Application.Run(mainForm);
        }   
    }
}
/*
Console.WriteLine("Start");
StatLines statLines = new StatLines();
CharacterClass inquisitorFighter = new CharacterClass(1, statLines);
inquisitorFighter.PrintValues();
Console.WriteLine("End");
*/